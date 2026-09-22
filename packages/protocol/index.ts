import { z } from "zod";

export const IceCandidateInit = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable(),
  sdpMLineIndex: z.number().nullable(),
});
export type IceCandidateInit = z.infer<typeof IceCandidateInit>;

export const AuraEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: z.enum(["idle", "listening", "thinking", "speaking"]) }),
  z.object({ kind: z.literal("user_transcript"), text: z.string() }),
  z.object({ kind: z.literal("aura_text"), text: z.string() }),
  z.object({ kind: z.literal("speak"), text: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AuraEvent = z.infer<typeof AuraEvent>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_session") }),
  z.object({ type: z.literal("register_sfu") }),
  z.object({ type: z.literal("register_agent") }),
  z.object({ type: z.literal("agent_offer"), sdp: z.string() }),
  z.object({ type: z.literal("agent_answer"), sdp: z.string() }),
  z.object({ type: z.literal("agent_ice"), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("offer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("answer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("ice_candidate"), sessionId: z.string(), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("close_session"), sessionId: z.string() }),
  z.object({ type: z.literal("aura_event"), event: AuraEvent }),
  z.object({ type: z.literal("session_reset") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_created"), sessionId: z.string() }),
  z.object({ type: z.literal("agent_offer"), sdp: z.string() }),
  z.object({ type: z.literal("agent_answer"), sdp: z.string() }),
  z.object({ type: z.literal("agent_ice"), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("offer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("answer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("ice_candidate"), sessionId: z.string(), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("error"), sessionId: z.string().optional(), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("aura_event"), event: AuraEvent }),
  z.object({ type: z.literal("agent_available") }),
  z.object({ type: z.literal("session_reset") }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type SessionState =
  | "new"
  | "offered"
  | "answered"
  | "connected"
  | "closed"
  | "failed";

export type Session = {
  sessionId: string;
  createdAt: number;
  state: SessionState;
  offer?: { sdp: string };
  answer?: { sdp: string };
};

export function isClientMessage(x: unknown): x is ClientMessage {
  return ClientMessage.safeParse(x).success;
}
