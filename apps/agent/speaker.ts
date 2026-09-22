import { Encoder } from "@evan/opus";
import { RtpPacket, RtpHeader, type MediaStreamTrack } from "werift";

const FRAME_SAMPLES = 960;
const FRAME_MS = 20;
const TS_PER_FRAME = 960;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export class AuraSpeaker {
  private seq = Math.floor(Math.random() * 0xffff);
  private timestamp = Math.floor(Math.random() * 0xffffffff);
  private readonly ssrc = Math.floor(Math.random() * 0xffffffff);

  constructor(private track: MediaStreamTrack) {}

  async speak(pcm48kMono: Int16Array, signal: AbortSignal): Promise<boolean> {
    const encoder = new Encoder({ channels: 1, sample_rate: 48000, application: "voip" });
    const total = Math.ceil(pcm48kMono.length / FRAME_SAMPLES);
    const startWall = Date.now();

    for (let f = 0; f < total; f++) {
      if (signal.aborted) return false;
      const offset = f * FRAME_SAMPLES;
      let frame: Int16Array;
      if (offset + FRAME_SAMPLES <= pcm48kMono.length) {
        frame = pcm48kMono.subarray(offset, offset + FRAME_SAMPLES);
      } else {
        frame = new Int16Array(FRAME_SAMPLES);
        frame.set(pcm48kMono.subarray(offset));
      }

      const opus = encoder.encode(frame);
      this.seq = (this.seq + 1) & 0xffff;
      this.timestamp = (this.timestamp + TS_PER_FRAME) >>> 0;
      const header = new RtpHeader({
        version: 2,
        payloadType: 96,
        sequenceNumber: this.seq,
        timestamp: this.timestamp,
        ssrc: this.ssrc,
        marker: f === 0,
      });
      this.track.writeRtp(new RtpPacket(header, Buffer.from(opus)));

      const targetWall = startWall + (f + 1) * FRAME_MS;
      const drift = targetWall - Date.now();
      if (drift > 1) await sleep(drift, signal);
    }
    return !signal.aborted;
  }
}
