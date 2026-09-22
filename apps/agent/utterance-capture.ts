export class UtteranceCapture {
  private ring: Int16Array[] = [];
  private ringSamples = 0;
  private current: Int16Array[] | null = null;

  constructor(
    private preRollSamples = 48000 * 0.3,
    private maxSamples = 48000 * 30,
  ) {}

  pushFrame(frame: Int16Array): void {
    const copy = frame.slice();
    if (this.current) {
      this.current.push(copy);
      return;
    }
    this.ring.push(copy);
    this.ringSamples += copy.length;
    while (this.ringSamples > this.preRollSamples && this.ring.length > 1) {
      this.ringSamples -= this.ring.shift()!.length;
    }
  }

  start(): void {
    this.current = [...this.ring];
    this.ring = [];
    this.ringSamples = 0;
  }

  stop(): Int16Array {
    if (!this.current) return new Int16Array(0);
    const frames = this.current;
    this.current = null;
    let total = 0;
    for (const f of frames) total += f.length;
    total = Math.min(total, this.maxSamples);
    const out = new Int16Array(total);
    let offset = 0;
    for (const f of frames) {
      if (offset >= total) break;
      const take = Math.min(f.length, total - offset);
      out.set(f.subarray(0, take), offset);
      offset += take;
    }
    return out;
  }

  get capturing(): boolean {
    return this.current !== null;
  }

  reset(): void {
    this.ring = [];
    this.ringSamples = 0;
    this.current = null;
  }
}
