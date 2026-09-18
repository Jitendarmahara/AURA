import { WebSocketServer, type WebSocket } from "ws";
import { isClientMessage, type ServerMessage } from "@aura/protocol";
import { SessionManager } from "./session-manager";

const wss = new WebSocketServer({ port: 8080 });
const sessions = new SessionManager();
let sfu: WebSocket | null = null;
const browsers = new Map<string, WebSocket>();

function send(socket: WebSocket, msg: ServerMessage) {
  socket.send(JSON.stringify(msg));
}

wss.on("connection", (socket) => {
  // Sessions created over this connection, so we can free them if it drops.
  const owned = new Set<string>();

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
        owned.add(session.sessionId);
        send(socket, { type: "session_created", sessionId: session.sessionId });
        break;
      }
      case "register_sfu": {
        sfu = socket;
        console.log("sfu registered");
        break;
      }
      case "offer": {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          send(socket, { type: "error", sessionId: parsed.sessionId, code: "unknown_session", message: "no such session" });
          break;
        }
        if (!sfu) {
          send(socket, { type: "error", sessionId: parsed.sessionId, code: "no_sfu", message: "sfu not connected" });
          break;
        }
        session.offer = { sdp: parsed.sdp };
        session.state = "offered";
        browsers.set(parsed.sessionId, socket); // remember who to send the answer back to
        send(sfu, { type: "offer", sessionId: parsed.sessionId, sdp: parsed.sdp });
        break;
      }
      case "answer": {
        const session = sessions.get(parsed.sessionId);
        if (session) {
          session.answer = { sdp: parsed.sdp };
          session.state = "answered";
        }
        const browser = browsers.get(parsed.sessionId);
        if (browser) send(browser, { type: "answer", sessionId: parsed.sessionId, sdp: parsed.sdp });
        break;
      }
      case "ice_candidate": {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          send(socket, { type: "error", sessionId: parsed.sessionId, code: "unknown_session", message: "no such session" });
          break;
        }
        // Relay to the other side: SFU's candidate -> browser, browser's -> SFU.
        const target = socket === sfu ? browsers.get(parsed.sessionId) : sfu;
        if (target) send(target, { type: "ice_candidate", sessionId: parsed.sessionId, candidate: parsed.candidate });
        break;
      }
      case "close_session": {
        sessions.remove(parsed.sessionId);
        owned.delete(parsed.sessionId);
        browsers.delete(parsed.sessionId);
        break;
      }
      default: {
        const _exhaustive: never = parsed;
        return _exhaustive;
      }
    }
  });

  socket.on("close", () => {
    // Free any sessions this connection created but never closed, so they don't leak.
    for (const sessionId of owned) {
      sessions.remove(sessionId);
      browsers.delete(sessionId);
    }
    owned.clear();
    if (socket === sfu) sfu = null; // SFU dropped; new offers will error until it reconnects
    console.log("connection closed");
  });
});

console.log("signaling server listening on :8080");
