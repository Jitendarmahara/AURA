export type PcmFrame = {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
};

type FrameHandler = (frame: PcmFrame) => void;

export class AudioProcessor {
  private handlers: FrameHandler[] = [];

  onOutput(handler: FrameHandler): void {
    this.handlers.push(handler);
  }

  process(frame: PcmFrame): void {
    let out = frame;
    if (frame.channels === 2) {
      const stereo = frame.samples;
      const mono = new Int16Array(stereo.length / 2);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (stereo[i * 2]! + stereo[i * 2 + 1]!) / 2;
      }
      out = { samples: mono, sampleRate: frame.sampleRate, channels: 1 };
    }
    for (const handler of this.handlers) handler(out);
  }
}
