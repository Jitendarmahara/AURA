import { WebSocket } from "ws";
import { RTCPeerConnection } from "werift";

const signaling = new WebSocket("ws://localhost:8080");
const peers = new Map<string, RTCPeerConnection>();

signaling.on("open", () => {
  console.log("sfu connected to signaling");
  signaling.send(JSON.stringify({ type: "register_sfu" }));
});

signaling.on("message", async (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "offer") {
    console.log("sfu got offer for", msg.sessionId);
    const pc = new RTCPeerConnection();
    peers.set(msg.sessionId, pc);
    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate) return;
      const c = candidate.toJSON();
      signaling.send(JSON.stringify({
        type: "ice_candidate",
        sessionId: msg.sessionId,
        candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null },
      }));
    });
    await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: "answer", sessionId: msg.sessionId, sdp: answer.sdp }));
  }
  if (msg.type === "ice_candidate") {
    const pc = peers.get(msg.sessionId);
    if (pc && msg.candidate) await pc.addIceCandidate(msg.candidate);
  }
});
