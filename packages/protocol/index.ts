
export type ClientMessage =
  | { type: "create_session" }
  | { type: "offer"; sessionId: string; sdp: string }
  | { type: "ice_candidate"; sessionId: string; candidate: string | null }
  | { type: "close_session"; sessionId: string };

export type ServerMessage =
  | { type: "session_created"; sessionId: string }
  | { type: "answer"; sessionId: string; sdp: string }
  | { type: "ice_candidate"; sessionId: string; candidate: string | null }
  | { type: "error"; sessionId?: string; code: string; message: string };

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
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  switch (m.type) {
    case "create_session":
      return true;
    case "offer":
      return typeof m.sessionId === "string" && typeof m.sdp === "string";
    case "ice_candidate":
      return (
        typeof m.sessionId === "string" &&
        (typeof m.candidate === "string" || m.candidate === null)
      );
    case "close_session":
      return typeof m.sessionId === "string";
    default:
      return false;
  }
}
