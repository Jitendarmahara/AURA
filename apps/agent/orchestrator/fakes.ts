import type { LLMClient, LLMRequest, LLMResponse, ToolCall } from "./types";

export type LlmStep = LLMResponse | ((req: LLMRequest) => Promise<LLMResponse>);

export class ScriptedLlm implements LLMClient {
  calls: LLMRequest[] = [];
  constructor(private steps: LlmStep[]) {}
  async chat(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const step = this.steps.shift();
    if (step === undefined) return { content: "(script exhausted)", toolCalls: [] };
    return typeof step === "function" ? step(req) : step;
  }
}

export function reply(content: string): LLMResponse {
  return { content, toolCalls: [] };
}

export function callTool(name: string, args: Record<string, unknown>, id = `call_${name}`): LLMResponse {
  const toolCall: ToolCall = { id, name, arguments: JSON.stringify(args) };
  return { content: null, toolCalls: [toolCall] };
}

export function delayedReject(ms: number, error: Error): (req: LLMRequest) => Promise<LLMResponse> {
  return (req) =>
    new Promise((_, rejectPromise) => {
      const t = setTimeout(() => rejectPromise(error), ms);
      req.signal?.addEventListener("abort", () => { clearTimeout(t); rejectPromise(new Error("timeout")); }, { once: true });
    });
}
