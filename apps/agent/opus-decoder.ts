import { Decoder } from "@evan/opus";

export class OpusDecoder {
  private decoder = new Decoder({ channels: 2, sample_rate: 48000 });

  get channels(): number {
    return this.decoder.channels;
  }

  get sampleRate(): number {
    return this.decoder.sample_rate;
  }

  decode(opus: Buffer): Int16Array {
    const pcm = this.decoder.decode(opus);
    return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  }
}
