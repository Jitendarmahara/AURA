import { WebSocketServer, type WebSocket } from "ws";
import { isClientMessage, type ServerMessage } from "@aura/protocol";
import { SessionManager } from "./session-manager";

const wss = new WebSocketServer({ port: 8080 });
const sessions = new SessionManager();

function send(socket: WebSocket, msg: ServerMessage) {
  socket.send(JSON.stringify(msg));
}

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", code: "invalid_json", message: "not valid JSON" });
      return;
    }

    if (!isClientMessage(parsed)) {
      send(socket, { type: "error", code: "invalid_message", message: "unknown message shape" });
      return;
    }
    switch (parsed.type) {
      case "create_session": {
        const session = sessions.create();
        send(socket, { type: "session_created", sessionId: session.sessionId });
        break;
      }
      case "offer": {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          send(socket, { type: "error", sessionId: parsed.sessionId, code: "unknown_session", message: "no such session" });
          break;
        }
        session.offer = { sdp: parsed.sdp };
        session.state = "offered";
        // (later) relay the offer to the SFU / peer, which produces the answer.
        break;
      }
      case "ice_candidate": {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          send(socket, { type: "error", sessionId: parsed.sessionId, code: "unknown_session", message: "no such session" });
          break;
        }
        // (later) relay the candidate to the peer. For now, acceptance is enough.
        console.log("ice candidate for", parsed.sessionId, parsed.candidate === null ? "(end)" : "");
        break;
      }
      case "close_session": {
        sessions.remove(parsed.sessionId);
        // No reply and no socket close: the client asked to close, so it already knows.
        // We just free the server-side state. (Idempotent: remove() of an unknown id is a no-op.)
        break;
      }
      default: {
        const _exhaustive: never = parsed;
        return _exhaustive;
      }
    }
  });

  socket.on("close", () => {
    console.log("connection closed");
  });
});

console.log("signaling server listening on :8080");
