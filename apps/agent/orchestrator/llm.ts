import type { LLMClient, LLMRequest, LLMResponse, LLMMessage, ToolCall } from "./types";

export type OpenAiLlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
};

type WireMessage = {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

function toWire(m: LLMMessage): WireMessage {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId, name: m.name };
  }
}

export class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmHttpError";
  }
}

function parseRetryAfterMs(res: Response, body: string): number | undefined {
  const header = res.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) return Number(header) * 1000;
  const match = body.match(/try again in ([\d.]+)\s*s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return undefined;
}

export class OpenAiLlmClient implements LLMClient {
  constructor(private config: OpenAiLlmConfig) {}

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.3,
      messages: req.messages.map(toWire),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: "auto" as const,
          }
        : {}),
    };

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new LlmHttpError(`llm http ${res.status}: ${detail.slice(0, 300)}`, res.status, parseRetryAfterMs(res, detail));
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    };
    const message = json.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments ?? "",
    }));
    return { content: message?.content ?? null, toolCalls };
  }
}
