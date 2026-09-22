import { WebSocket } from "ws";
import { RTCPeerConnection, MediaStreamTrack } from "werift";

const IGNORED_NET_ERRORS = ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "EADDRNOTAVAIL"];
process.on("uncaughtException", (err) => {
  if (IGNORED_NET_ERRORS.includes((err as { code?: string }).code ?? "")) return;
  console.error("sfu uncaught:", err);
});

function reachableHost(host: string): boolean {
  if (host.includes(":")) return false;
  if (host.startsWith("169.254.")) return false;
  if (host.startsWith("172.")) return false;
  return true;
}

const signaling = new WebSocket("ws://localhost:8080");
const peers = new Map<string, RTCPeerConnection>();
const browserOuts = new Map<string, MediaStreamTrack>();
let agentPc: RTCPeerConnection | null = null;
let agentAudioIn: MediaStreamTrack | null = null;

async function connectToAgent() {
  if (agentPc) {
    try { agentPc.close(); } catch {}
  }
  agentPc = new RTCPeerConnection({
    iceUseIpv6: false,
    iceFilterCandidatePair: (pair) => reachableHost(pair.remoteCandidate.host),
  });
  agentAudioIn = new MediaStreamTrack({ kind: "audio" });
  agentPc.addTransceiver(agentAudioIn, { direction: "sendrecv" });
  agentPc.connectionStateChange.subscribe((s) => console.log("sfu<->agent state:", s));
  agentPc.onTrack.subscribe((track) => {
    if (track.kind !== "audio") return;
    console.log("sfu received AURA audio track from agent");
    track.onReceiveRtp.subscribe((rtp) => {
      for (const out of browserOuts.values()) out.writeRtp(rtp);
    });
  });
  agentPc.onIceCandidate.subscribe((candidate) => {
    if (!candidate) return;
    const c = candidate.toJSON();
    signaling.send(JSON.stringify({ type: "agent_ice", candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } }));
  });
  const offer = await agentPc.createOffer();
  await agentPc.setLocalDescription(offer);
  signaling.send(JSON.stringify({ type: "agent_offer", sdp: offer.sdp }));
  console.log("sfu sent agent_offer");
}

signaling.on("open", () => {
  console.log("sfu connected to signaling");
  signaling.send(JSON.stringify({ type: "register_sfu" }));
});

signaling.on("message", async (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "agent_available") {
    console.log("sfu notified agent is available, offering");
    connectToAgent();
  }
  if (msg.type === "offer") {
    console.log("sfu got offer for", msg.sessionId);
    signaling.send(JSON.stringify({ type: "session_reset" }));
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peers.set(msg.sessionId, pc);
    const out = new MediaStreamTrack({ kind: "audio" });
    browserOuts.set(msg.sessionId, out);
    pc.iceConnectionStateChange.subscribe((s) => console.log("sfu ice state:", s));
    pc.connectionStateChange.subscribe((s) => {
      console.log("sfu conn state:", s);
      if (s === "failed" || s === "closed" || s === "disconnected") browserOuts.delete(msg.sessionId);
    });
    pc.onTrack.subscribe((track) => {
      if (track.kind !== "audio") return;
      console.log("sfu received audio track for", msg.sessionId);
      track.onReceiveRtp.subscribe((rtp) => {
        if (agentAudioIn) agentAudioIn.writeRtp(rtp);
      });
    });
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
    pc.addTrack(out);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: "answer", sessionId: msg.sessionId, sdp: answer.sdp }));
  }
  if (msg.type === "agent_answer" && agentPc) {
    await agentPc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    console.log("sfu applied agent_answer");
  }
  if (msg.type === "agent_ice" && agentPc && msg.candidate) {
    await agentPc.addIceCandidate(msg.candidate);
  }
  if (msg.type === "ice_candidate") {
    const pc = peers.get(msg.sessionId);
    if (pc && msg.candidate) await pc.addIceCandidate(msg.candidate);
  }
});
