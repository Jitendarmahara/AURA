import { WebSocket } from "ws";
import { RTCPeerConnection } from "werift";

const c = new WebSocket("ws://localhost:8080");
const pc = new RTCPeerConnection();
pc.createDataChannel("chat");
let sessionId = "";

pc.iceConnectionStateChange.subscribe((s) => console.log("browser ice state:", s));
pc.connectionStateChange.subscribe((s) => {
  console.log("browser conn state:", s);
  if (s === "connected") process.exit(0);
});

pc.onIceCandidate.subscribe((candidate) => {
  if (!candidate || !sessionId) return;
  const j = candidate.toJSON();
  c.send(JSON.stringify({
    type: "ice_candidate",
    sessionId,
    candidate: { candidate: j.candidate, sdpMid: j.sdpMid ?? null, sdpMLineIndex: j.sdpMLineIndex ?? null },
  }));
});

c.on("open", () => c.send(JSON.stringify({ type: "create_session" })));
c.on("message", async (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "session_created") {
    sessionId = msg.sessionId;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    c.send(JSON.stringify({ type: "offer", sessionId, sdp: offer.sdp }));
  }
  if (msg.type === "answer") await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
  if (msg.type === "ice_candidate" && msg.candidate) await pc.addIceCandidate(msg.candidate);
});
