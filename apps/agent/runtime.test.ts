import { test, expect } from "bun:test";
import { AgentRuntime, type RuntimeEvent, type Orchestrator, type Speaker } from "./runtime";
import type { Stt } from "./stt";
import type { Tts } from "./tts";
import type { TurnResult } from "./orchestrator/types";

function pcm(seconds: number): Int16Array {
  const n = Math.floor(48000 * seconds);
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = i % 2 ? 3000 : -3000;
  return a;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class FakeStt implements Stt {
  calls = 0;
  constructor(private fn: (n: number, signal?: AbortSignal) => Promise<string>) {}
  transcribe(_pcm: Int16Array, signal?: AbortSignal): Promise<string> {
    this.calls++;
    return this.fn(this.calls, signal);
  }
}

class FakeTts implements Tts {
  async synthesize(): Promise<Int16Array> {
    return pcm(0.1);
  }
}

class FakeOrchestrator implements Orchestrator {
  utterances: string[] = [];
  constructor(private fn: (text: string) => TurnResult = (text) => ({ text: `re: ${text}`, toolCalls: [], aborted: false })) {}
  async handleUtterance(text: string): Promise<TurnResult> {
    this.utterances.push(text);
    return this.fn(text);
  }
}

class FakeSpeaker implements Speaker {
  spoken: Int16Array[] = [];
  aborted = false;
  constructor(private hold?: Promise<void>) {}
  async speak(audio: Int16Array, signal: AbortSignal): Promise<boolean> {
    this.spoken.push(audio);
    if (this.hold) {
      await Promise.race([
        this.hold,
        new Promise<void>((resolve) => signal.addEventListener("abort", () => { this.aborted = true; resolve(); }, { once: true })),
      ]);
    }
    return !signal.aborted;
  }
}

function collect(runtime: AgentRuntime): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  runtime.onEvent((e) => events.push(e));
  return events;
}

test("happy path: speech -> stt -> orchestrator -> tts -> speaker", async () => {
  const stt = new FakeStt(async () => "book two tickets");
  const orch = new FakeOrchestrator(() => ({ text: "Booked two tickets.", toolCalls: [], aborted: false }));
  const speaker = new FakeSpeaker();
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), speaker);
  const events = collect(runtime);

  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(20);

  expect(orch.utterances).toEqual(["book two tickets"]);
  expect(speaker.spoken.length).toBe(1);
  const kinds = events.map((e) => (e.kind === "status" ? `status:${e.status}` : e.kind));
  expect(kinds).toContain("status:listening");
  expect(kinds).toContain("user_transcript");
  expect(kinds).toContain("aura_text");
  expect(kinds).toContain("status:speaking");
  expect(kinds[kinds.length - 1]).toBe("status:idle");
});

test("too-short utterances are ignored (no STT)", async () => {
  const stt = new FakeStt(async () => "noise");
  const orch = new FakeOrchestrator();
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), new FakeSpeaker());
  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(0.1));
  await Bun.sleep(10);
  expect(stt.calls).toBe(0);
  expect(orch.utterances.length).toBe(0);
});

test("stale STT result from an interrupted turn is discarded", async () => {
  const gate = deferred<void>();
  const stt = new FakeStt(async (n) => {
    if (n === 1) { await gate.promise; return "first, interrupted"; }
    return "second";
  });
  const orch = new FakeOrchestrator();
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), new FakeSpeaker());

  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(5);

  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(5);

  gate.resolve();
  await Bun.sleep(20);

  expect(orch.utterances).toEqual(["second"]);
});

test("barge-in aborts the speaker mid-utterance", async () => {
  const hold = deferred<void>();
  const stt = new FakeStt(async () => "tell me a long story");
  const orch = new FakeOrchestrator(() => ({ text: "Once upon a time...", toolCalls: [], aborted: false }));
  const speaker = new FakeSpeaker(hold.promise);
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), speaker);
  const events = collect(runtime);

  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(20);
  expect(runtime.isSpeaking).toBe(true);

  runtime.onSpeechStarted();
  await Bun.sleep(10);

  expect(speaker.aborted).toBe(true);
  expect(runtime.isSpeaking).toBe(false);
  const listeningCount = events.filter((e) => e.kind === "status" && e.status === "listening").length;
  expect(listeningCount).toBe(2);
  hold.resolve();
});

test("multiple sequential turns each produce a response", async () => {
  const stt = new FakeStt(async (n) => (n === 1 ? "first turn" : "second turn"));
  const orch = new FakeOrchestrator((t) => ({ text: `ack ${t}`, toolCalls: [], aborted: false }));
  const speaker = new FakeSpeaker();
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), speaker);

  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(20);
  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(20);

  expect(orch.utterances).toEqual(["first turn", "second turn"]);
  expect(speaker.spoken.length).toBe(2);
});

test("an aborted orchestrator turn does not reach TTS", async () => {
  const stt = new FakeStt(async () => "something");
  const orch = new FakeOrchestrator(() => ({ text: "", toolCalls: [], aborted: true }));
  const speaker = new FakeSpeaker();
  const runtime = new AgentRuntime(orch, stt, new FakeTts(), speaker);
  runtime.onSpeechStarted();
  runtime.onTurnEnded(pcm(1));
  await Bun.sleep(20);
  expect(speaker.spoken.length).toBe(0);
});
