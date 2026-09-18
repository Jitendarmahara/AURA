import { z } from "zod";

export const IceCandidateInit = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable(),
  sdpMLineIndex: z.number().nullable(),
});
export type IceCandidateInit = z.infer<typeof IceCandidateInit>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_session") }),
  z.object({ type: z.literal("register_sfu") }),
  z.object({ type: z.literal("offer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("answer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("ice_candidate"), sessionId: z.string(), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("close_session"), sessionId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_created"), sessionId: z.string() }),
  z.object({ type: z.literal("offer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("answer"), sessionId: z.string(), sdp: z.string() }),
  z.object({ type: z.literal("ice_candidate"), sessionId: z.string(), candidate: IceCandidateInit.nullable() }),
  z.object({ type: z.literal("error"), sessionId: z.string().optional(), code: z.string(), message: z.string() }),
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
