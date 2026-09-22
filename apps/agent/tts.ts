import { config } from "./config";
import { decodeWav, resamplePcm, toMono } from "./audio";

export interface Tts {
  synthesize(text: string, signal?: AbortSignal): Promise<Int16Array>;
}

export class GroqTts implements Tts {
  async synthesize(text: string, signal?: AbortSignal): Promise<Int16Array> {
    const res = await fetch(`${config.tts.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: config.tts.model,
        voice: config.tts.voice,
        input: text,
        response_format: "wav",
      }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`tts http ${res.status}: ${detail.slice(0, 300)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { samples, sampleRate, channels } = decodeWav(bytes);
    const mono = toMono(samples, channels);
    return resamplePcm(mono, sampleRate, 48000);
  }
}
