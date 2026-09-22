import { test, expect } from "bun:test";
import { ConversationOrchestrator, dedupeText, type OrchestratorOptions } from "./orchestrator";
import { BookingStore } from "./state";
import { createTools } from "./tools";
import { ScriptedLlm, reply, callTool, delayedReject, type LlmStep } from "./fakes";

function setup(steps: LlmStep[], opts: Partial<OrchestratorOptions> = {}) {
  let n = 0;
  const store = new BookingStore(() => `b${++n}`);
  const llm = new ScriptedLlm(steps);
  const orch = new ConversationOrchestrator(llm, createTools(store), {
    systemPrompt: "test",
    maxToolRounds: 4,
    llmTimeoutMs: 100,
    maxLlmRetries: 2,
    ...opts,
  });
  return { store, llm, orch };
}

test("dedupeText collapses exact and near-duplicate sentences", () => {
  expect(dedupeText("Your train is booked.Your train is booked.")).toBe("Your train is booked.");
  expect(dedupeText("The booking was cancelled. The booking has been cancelled.")).toBe("The booking was cancelled.");
  expect(dedupeText("It's 19 degrees with light rain.")).toBe("It's 19 degrees with light rain.");
  expect(dedupeText("I booked two tickets. Enjoy the show!")).toBe("I booked two tickets. Enjoy the show!");
});

test("books a movie ticket then replies naturally", async () => {
  const { store, orch } = setup([
    callTool("book_movie_ticket", { movie: "Dune", time: "20:00", count: 2 }),
    reply("Done, two tickets for Dune at 8."),
  ]);
  const r = await orch.handleUtterance("book two for dune at 8", new AbortController().signal);
  expect(r.text).toContain("Dune");
  expect(r.toolCalls[0]!.result.ok).toBe(true);
  expect(store.all().length).toBe(1);
  expect(store.all()[0]!.status).toBe("confirmed");
});

test("asks a clarifying question when no tool is called", async () => {
  const { orch } = setup([reply("Which movie would you like?")]);
  const r = await orch.handleUtterance("book me tickets", new AbortController().signal);
  expect(r.text).toBe("Which movie would you like?");
  expect(r.toolCalls.length).toBe(0);
});

test("multi-turn: history is retained across utterances", async () => {
  const { orch } = setup([reply("Which movie?"), callTool("book_movie_ticket", { movie: "Oppenheimer", time: "20:15", count: 1 }), reply("Booked Oppenheimer.")]);
  await orch.handleUtterance("book a ticket", new AbortController().signal);
  const r = await orch.handleUtterance("Oppenheimer at 8:15", new AbortController().signal);
  expect(r.text).toContain("Oppenheimer");
  const users = orch.getHistory().filter((m) => m.role === "user");
  expect(users.length).toBe(2);
});

test("cancellation resolves 'that' to the latest booking", async () => {
  const { store, orch } = setup([
    callTool("book_movie_ticket", { movie: "Dune", time: "20:00", count: 2 }),
    reply("Booked."),
    callTool("cancel_movie_ticket", {}),
    reply("Cancelled that for you."),
  ]);
  await orch.handleUtterance("book two for dune at 8", new AbortController().signal);
  const r = await orch.handleUtterance("actually cancel that", new AbortController().signal);
  expect(r.toolCalls[0]!.result.ok).toBe(true);
  expect(store.all()[0]!.status).toBe("cancelled");
  expect(r.text).toContain("Cancelled");
});

test("tool failure returns a structured error the model can react to", async () => {
  let sawError = false;
  const { orch } = setup([
    callTool("book_movie_ticket", { movie: "Nonexistent Film", time: "20:00", count: 1 }),
    async () => {
      sawError = true;
      return reply("I couldn't find that movie, want me to list what's playing?");
    },
  ]);
  const r = await orch.handleUtterance("book nonexistent film", new AbortController().signal);
  expect(r.toolCalls[0]!.result.ok).toBe(false);
  expect(r.toolCalls[0]!.result.error!.code).toBe("unknown_movie");
  expect(sawError).toBe(true);
});

test("stale: aborting before tools run leaves state and history untouched", async () => {
  const controller = new AbortController();
  const { store, orch } = setup([
    async () => {
      controller.abort();
      return callTool("book_movie_ticket", { movie: "Dune", time: "20:00", count: 2 });
    },
  ]);
  const r = await orch.handleUtterance("book dune", controller.signal);
  expect(r.aborted).toBe(true);
  expect(store.all().length).toBe(0);
  expect(orch.getHistory().filter((m) => m.role !== "system").length).toBe(0);
});

test("aborting during the LLM call yields an aborted turn", async () => {
  const controller = new AbortController();
  const { orch } = setup([
    async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    },
  ]);
  const r = await orch.handleUtterance("hello", controller.signal);
  expect(r.aborted).toBe(true);
});

test("timeout then retry then success", async () => {
  const { orch, llm } = setup(
    [delayedReject(500, new Error("too slow")), reply("Recovered.")],
    { llmTimeoutMs: 50, maxLlmRetries: 2 },
  );
  const r = await orch.handleUtterance("hi", new AbortController().signal);
  expect(r.text).toBe("Recovered.");
  expect(llm.calls.length).toBe(2);
});

test("retries a transient error then succeeds", async () => {
  let attempts = 0;
  const { orch } = setup([
    async () => {
      attempts++;
      throw new Error("transient 503");
    },
    reply("Second try worked."),
  ]);
  const r = await orch.handleUtterance("hi", new AbortController().signal);
  expect(attempts).toBe(1);
  expect(r.text).toBe("Second try worked.");
});

test("gives up gracefully after exhausting retries", async () => {
  const { orch } = setup(
    [
      async () => { throw new Error("down"); },
      async () => { throw new Error("down"); },
      async () => { throw new Error("down"); },
    ],
    { maxLlmRetries: 2 },
  );
  const r = await orch.handleUtterance("hi", new AbortController().signal);
  expect(r.aborted).toBe(false);
  expect(r.text.toLowerCase()).toContain("something went wrong");
});

test("stops after maxToolRounds to avoid infinite loops", async () => {
  const { orch } = setup(
    [
      callTool("search_movies", {}),
      callTool("search_movies", {}),
      callTool("search_movies", {}),
      callTool("search_movies", {}),
    ],
    { maxToolRounds: 2 },
  );
  const r = await orch.handleUtterance("loop", new AbortController().signal);
  expect(r.toolCalls.length).toBe(2);
  expect(r.text.length).toBeGreaterThan(0);
});
