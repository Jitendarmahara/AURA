import { WebSocket } from "ws";
import { RTCPeerConnection, MediaStreamTrack } from "werift";
import { config } from "./config";
import { AudioInput } from "./audio-input";
import { OpusDecoder } from "./opus-decoder";
import { AudioProcessor } from "./audio-processor";
import { VAD } from "./vad";
import { TurnManager } from "./turn-manager";
import { UtteranceCapture } from "./utterance-capture";
import { AgentRuntime, type RuntimeEvent } from "./runtime";
import { AuraSpeaker } from "./speaker";
import { GroqStt } from "./stt";
import { GroqTts } from "./tts";
import { OpenAiLlmClient } from "./orchestrator/llm";
import { ConversationOrchestrator } from "./orchestrator/orchestrator";
import { BookingStore } from "./orchestrator/state";
import { createTools } from "./orchestrator/tools";
import { systemPrompt } from "./persona";

const IGNORED_NET_ERRORS = ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "EADDRNOTAVAIL"];
process.on("uncaughtException", (err) => {
  if (IGNORED_NET_ERRORS.includes((err as { code?: string }).code ?? "")) return;
  console.error("agent uncaught:", err);
});

const vad = await VAD.create(48000, 3);

function reachableHost(host: string): boolean {
  if (host.includes(":")) return false;
  if (host.startsWith("169.254.")) return false;
  if (host.startsWith("172.")) return false;
  return true;
}

const pc = new RTCPeerConnection({
  iceUseIpv6: false,
  iceFilterCandidatePair: (pair) => reachableHost(pair.remoteCandidate.host),
});
const signaling = new WebSocket(config.signalingUrl);
const auraOut = new MediaStreamTrack({ kind: "audio" });

pc.connectionStateChange.subscribe((s) => console.log("agent<->sfu state:", s));
const audioInput = new AudioInput();
const decoder = new OpusDecoder();
const audioProcessor = new AudioProcessor();
const capture = new UtteranceCapture();

const store = new BookingStore();
const llm = new OpenAiLlmClient({ baseUrl: config.llm.baseUrl, apiKey: config.llm.apiKey, model: config.llm.model });
const orchestrator = new ConversationOrchestrator(llm, createTools(store), { systemPrompt: systemPrompt() });
const speaker = new AuraSpeaker(auraOut);
const runtime = new AgentRuntime(orchestrator, new GroqStt(), new GroqTts(), speaker);

function sendEvent(e: RuntimeEvent) {
  if (signaling.readyState === WebSocket.OPEN) signaling.send(JSON.stringify({ type: "aura_event", event: e }));
}
runtime.onEvent((e) => {
  if (e.kind === "user_transcript") console.log("user:", e.text);
  if (e.kind === "aura_text") console.log("aura:", e.text);
  if (e.kind === "error") console.error("runtime error:", e.message);
  sendEvent(e);
});

const turnManager = new TurnManager(25);
turnManager.onEvent((event) => {
  if (event === "SPEECH_STARTED") {
    capture.start();
    runtime.onSpeechStarted();
  } else if (event === "TURN_ENDED") {
    runtime.onTurnEnded(capture.stop(), turnManager.voicedFrames);
  }
});

audioProcessor.onOutput((frame) => {
  capture.pushFrame(frame.samples);
  turnManager.process(vad.isSpeech(frame.samples));
});

audioInput.onAudio((chunk) => {
  const pcm = decoder.decode(chunk.data);
  audioProcessor.process({ samples: pcm, sampleRate: decoder.sampleRate, channels: decoder.channels });
});

pc.onTrack.subscribe((track) => {
  if (track.kind !== "audio") return;
  console.log("agent received audio track, ssrc:", track.ssrc);
  track.onReceiveRtp.subscribe((rtp) => {
    audioInput.push({ data: rtp.payload, timestamp: rtp.header.timestamp, payloadType: rtp.header.payloadType });
  });
});

pc.onIceCandidate.subscribe((candidate) => {
  if (!candidate) return;
  const c = candidate.toJSON();
  signaling.send(JSON.stringify({ type: "agent_ice", candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } }));
});

signaling.on("open", () => {
  console.log("agent connected to signaling, pc state:", pc.connectionState);
  signaling.send(JSON.stringify({ type: "register_agent" }));
});

signaling.on("message", async (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "agent_offer") {
    await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
    pc.addTrack(auraOut);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signaling.send(JSON.stringify({ type: "agent_answer", sdp: answer.sdp }));
    console.log("agent sent agent_answer (with return audio track)");
  }
  if (msg.type === "agent_ice" && msg.candidate) {
    await pc.addIceCandidate(msg.candidate);
  }
  if (msg.type === "session_reset") {
    turnManager.reset();
    capture.reset();
    runtime.reset();
    orchestrator.reset();
    console.log("session reset: fresh conversation for new browser");
  }
});

console.log("agent ready:", { llm: config.llm.model, stt: config.stt.model, tts: `${config.tts.model}/${config.tts.voice}` });
