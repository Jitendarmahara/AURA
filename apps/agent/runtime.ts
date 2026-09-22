import type { Stt } from "./stt";
import type { Tts } from "./tts";
import type { TurnResult } from "./orchestrator/types";

export interface Orchestrator {
  handleUtterance(text: string, signal: AbortSignal): Promise<TurnResult>;
}

export type AuraStatus = "idle" | "listening" | "thinking" | "speaking";

export type RuntimeEvent =
  | { kind: "status"; status: AuraStatus }
  | { kind: "user_transcript"; text: string }
  | { kind: "aura_text"; text: string }
  | { kind: "speak"; text: string }
  | { kind: "error"; message: string };

export interface Speaker {
  speak(pcm48kMono: Int16Array, signal: AbortSignal): Promise<boolean>;
}

const MIN_UTTERANCE_SAMPLES = 48000 * 0.3;
const MIN_VOICED_FRAMES = 10;
const MIN_RMS = 180;

function rms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length);
}

export class AgentRuntime {
  private activeGen = 0;
  private controller: AbortController | null = null;
  private speaking = false;
  private ttsBroken = false;
  private handlers: ((e: RuntimeEvent) => void)[] = [];

  constructor(
    private orchestrator: Orchestrator,
    private stt: Stt,
    private tts: Tts,
    private speaker: Speaker,
  ) {}

  onEvent(handler: (e: RuntimeEvent) => void): void {
    this.handlers.push(handler);
  }

  private emit(e: RuntimeEvent): void {
    for (const h of this.handlers) h(e);
  }

  reset(): void {
    this.activeGen++;
    this.controller?.abort();
    this.controller = null;
    this.speaking = false;
    this.emit({ kind: "status", status: "idle" });
  }

  onSpeechStarted(): void {
    this.activeGen++;
    this.controller?.abort();
    this.controller = new AbortController();
    this.emit({ kind: "status", status: "listening" });
  }

  onTurnEnded(pcm: Int16Array, voicedFrames = MIN_VOICED_FRAMES): void {
    if (!this.controller) return;
    const gen = this.activeGen;
    const signal = this.controller.signal;
    void this.pipeline(pcm, voicedFrames, gen, signal);
  }

  private stale(gen: number, signal: AbortSignal): boolean {
    return gen !== this.activeGen || signal.aborted;
  }

  private async pipeline(pcm: Int16Array, voicedFrames: number, gen: number, signal: AbortSignal): Promise<void> {
    try {
      if (pcm.length < MIN_UTTERANCE_SAMPLES || voicedFrames < MIN_VOICED_FRAMES || rms(pcm) < MIN_RMS) {
        this.emit({ kind: "status", status: "idle" });
        return;
      }
      this.emit({ kind: "status", status: "thinking" });

      const transcript = await this.stt.transcribe(pcm, signal);
      if (this.stale(gen, signal)) return;
      if (!transcript.trim()) {
        this.emit({ kind: "status", status: "idle" });
        return;
      }
      this.emit({ kind: "user_transcript", text: transcript });

      const result = await this.orchestrator.handleUtterance(transcript, signal);
      if (this.stale(gen, signal) || result.aborted) return;
      if (!result.text.trim()) {
        this.emit({ kind: "status", status: "idle" });
        return;
      }
      this.emit({ kind: "aura_text", text: result.text });

      if (this.ttsBroken) {
        this.emit({ kind: "speak", text: result.text });
        this.emit({ kind: "status", status: "idle" });
        return;
      }

      let audio: Int16Array;
      try {
        audio = await this.tts.synthesize(result.text, signal);
      } catch (err) {
        if (signal.aborted) return;
        this.ttsBroken = true;
        this.emit({ kind: "speak", text: result.text });
        this.emit({ kind: "status", status: "idle" });
        return;
      }
      if (this.stale(gen, signal)) return;

      this.speaking = true;
      this.emit({ kind: "status", status: "speaking" });
      await this.speaker.speak(audio, signal);
      this.speaking = false;
      if (!this.stale(gen, signal)) this.emit({ kind: "status", status: "idle" });
    } catch (err) {
      this.speaking = false;
      if (signal.aborted) return;
      this.emit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      this.emit({ kind: "status", status: "idle" });
    }
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}
