import { config } from "./config";
import { encodeWav, resamplePcm } from "./audio";

export interface Stt {
  transcribe(pcm48kMono: Int16Array, signal?: AbortSignal): Promise<string>;
}

const HALLUCINATIONS = new Set([
  "", "you", "thank you", "thanks", "thank you very much", "thanks for watching",
  "thank you for watching", "please subscribe", "subscribe", "bye", "bye bye", "goodbye",
  "see you", "see you next time", "so", "okay", "ok", "yeah", "yes", "no", "hmm", "mm",
  "uh", "um", "the", ".", "..", "...", "music", "applause", "silence",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

type Segment = { no_speech_prob?: number; avg_logprob?: number };

export class GroqStt implements Stt {
  async transcribe(pcm48kMono: Int16Array, signal?: AbortSignal): Promise<string> {
    const pcm16k = resamplePcm(pcm48kMono, 48000, 16000);
    const wav = encodeWav(pcm16k, 16000, 1);
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "utterance.wav");
    form.append("model", config.stt.model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    form.append("language", "en");

    const res = await fetch(`${config.stt.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.groqApiKey}` },
      body: form,
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`stt http ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { text?: string; segments?: Segment[] };
    const text = (json.text ?? "").trim();
    const segments = json.segments ?? [];

    if (segments.length) {
      const avgNoSpeech = segments.reduce((a, s) => a + (s.no_speech_prob ?? 0), 0) / segments.length;
      const avgLogprob = segments.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / segments.length;
      if (avgNoSpeech > 0.6 || avgLogprob < -1.2) return "";
    }

    const norm = normalize(text);
    if (HALLUCINATIONS.has(norm)) return "";
    if (norm.length < 2) return "";

    return text;
  }
}
