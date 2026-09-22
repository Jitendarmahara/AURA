export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMRequest = {
  messages: LLMMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
};

export type LLMResponse = {
  content: string | null;
  toolCalls: ToolCall[];
};

export interface LLMClient {
  chat(req: LLMRequest): Promise<LLMResponse>;
}

export type ToolResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export interface Tool {
  spec: ToolSpec;
  run(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

export type TurnResult = {
  text: string;
  toolCalls: { name: string; result: ToolResult }[];
  aborted: boolean;
};

export class StaleTurnError extends Error {
  constructor() {
    super("turn superseded");
    this.name = "StaleTurnError";
  }
}
