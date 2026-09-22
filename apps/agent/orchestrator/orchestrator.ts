import type { LLMClient, LLMMessage, Tool, ToolResult, TurnResult, ToolSpec } from "./types";
import { LlmHttpError } from "./llm";

export type OrchestratorOptions = {
  systemPrompt: string;
  maxToolRounds?: number;
  llmTimeoutMs?: number;
  maxLlmRetries?: number;
  toolTimeoutMs?: number;
  maxHistoryMessages?: number;
  maxRateLimitWaitMs?: number;
};

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message === "aborted");
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "was", "are", "were", "be", "been", "being", "has", "have", "had",
  "to", "for", "of", "at", "on", "in", "your", "you", "it", "its", "now", "right", "i", "me", "my", "and",
]);

function wordSet(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  return new Set(words);
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size < 2 || B.size < 2) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6;
}

export function dedupeText(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentences || sentences.length < 2) return text;
  const kept: string[] = [];
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if (kept.length && similar(kept[kept.length - 1]!.trim(), t)) continue;
    kept.push(s);
  }
  const out = kept.join(" ").replace(/\s+/g, " ").trim();
  return out || text;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), ms);
  try {
    return await work(ctrl.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

export class ConversationOrchestrator {
  private history: LLMMessage[] = [];
  private readonly maxToolRounds: number;
  private readonly llmTimeoutMs: number;
  private readonly maxLlmRetries: number;
  private readonly toolTimeoutMs: number;
  private readonly maxHistoryMessages: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly toolMap: Map<string, Tool>;
  private readonly toolSpecs: ToolSpec[];

  constructor(
    private llm: LLMClient,
    private tools: Tool[],
    private opts: OrchestratorOptions,
  ) {
    this.maxToolRounds = opts.maxToolRounds ?? 5;
    this.llmTimeoutMs = opts.llmTimeoutMs ?? 15000;
    this.maxLlmRetries = opts.maxLlmRetries ?? 2;
    this.toolTimeoutMs = opts.toolTimeoutMs ?? 10000;
    this.maxHistoryMessages = opts.maxHistoryMessages ?? 24;
    this.maxRateLimitWaitMs = opts.maxRateLimitWaitMs ?? 9000;
    this.toolMap = new Map(tools.map((t) => [t.spec.name, t]));
    this.toolSpecs = tools.map((t) => t.spec);
    this.history.push({ role: "system", content: opts.systemPrompt });
  }

  getHistory(): LLMMessage[] {
    return this.history;
  }

  reset(): void {
    this.history = [{ role: "system", content: this.opts.systemPrompt }];
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
  }

  private windowedHistory(): LLMMessage[] {
    if (this.history.length <= this.maxHistoryMessages + 1) return this.history;
    const system = this.history[0]!;
    const rest = this.history.slice(1);
    let start = rest.length - this.maxHistoryMessages;
    while (start < rest.length && rest[start]!.role !== "user") start++;
    if (start >= rest.length) return this.history;
    return [system, ...rest.slice(start)];
  }

  private async callLlm(signal: AbortSignal) {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxLlmRetries; attempt++) {
      this.throwIfAborted(signal);
      try {
        return await withTimeout(
          (inner) => this.llm.chat({ messages: this.windowedHistory(), tools: this.toolSpecs, signal: inner }),
          this.llmTimeoutMs,
          signal,
        );
      } catch (err) {
        if (isAbort(err) && signal.aborted) throw err;
        lastErr = err;
        if (attempt >= this.maxLlmRetries) break;
        let waitMs = 250 * (attempt + 1);
        if (err instanceof LlmHttpError && err.status === 429) {
          waitMs = Math.min((err.retryAfterMs ?? 1500) + 200, this.maxRateLimitWaitMs);
        }
        await sleep(waitMs, signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("llm failed");
  }

  private async runTool(name: string, argsJson: string, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.toolMap.get(name);
    if (!tool) return { ok: false, error: { code: "unknown_tool", message: `no tool named ${name}` } };
    let args: Record<string, unknown>;
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      return { ok: false, error: { code: "bad_arguments", message: "tool arguments were not valid JSON" } };
    }
    try {
      return await withTimeout((inner) => tool.run(args, inner), this.toolTimeoutMs, signal);
    } catch (err) {
      if (isAbort(err) && signal.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: "tool_threw", message } };
    }
  }

  async handleUtterance(text: string, signal: AbortSignal): Promise<TurnResult> {
    const baseLen = this.history.length;
    let committedRounds = 0;
    const executed: { name: string; result: ToolResult }[] = [];
    this.history.push({ role: "user", content: text });

    try {
      for (let round = 0; round < this.maxToolRounds; round++) {
        const response = await this.callLlm(signal);

        if (!response.toolCalls.length) {
          const content = dedupeText(response.content ?? "");
          this.history.push({ role: "assistant", content });
          return { text: content, toolCalls: executed, aborted: false };
        }

        this.throwIfAborted(signal);
        const toolMessages: LLMMessage[] = [];
        for (const call of response.toolCalls) {
          this.throwIfAborted(signal);
          const result = await this.runTool(call.name, call.arguments, signal);
          executed.push({ name: call.name, result });
          toolMessages.push({
            role: "tool",
            content: JSON.stringify(result),
            toolCallId: call.id,
            name: call.name,
          });
        }
        this.history.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        this.history.push(...toolMessages);
        committedRounds++;
      }

      const fallback = "Sorry, I got stuck working that out. Could you say that again?";
      this.history.push({ role: "assistant", content: fallback });
      return { text: fallback, toolCalls: executed, aborted: false };
    } catch (err) {
      if (isAbort(err) && signal.aborted) {
        if (committedRounds === 0) this.history.length = baseLen;
        return { text: "", toolCalls: executed, aborted: true };
      }
      console.error("orchestrator turn failed:", err instanceof Error ? err.message : err);
      this.history.length = baseLen;
      const message = "Sorry, something went wrong on my end. Want to try that again?";
      this.history.push({ role: "user", content: text });
      this.history.push({ role: "assistant", content: message });
      return { text: message, toolCalls: executed, aborted: false };
    }
  }
}
