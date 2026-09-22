import createFvad, { type FvadModule } from "@echogarden/fvad-wasm";

export class VAD {
  private constructor(private module: FvadModule, private inst: number) {}

  static async create(sampleRate = 48000, mode = 3): Promise<VAD> {
    const module = await createFvad();
    const inst = module._fvad_new();
    module._fvad_set_mode(inst, mode);
    module._fvad_set_sample_rate(inst, sampleRate);
    return new VAD(module, inst);
  }

  isSpeech(frame: Int16Array): boolean {
    const ptr = this.module._malloc(frame.length * 2);
    this.module.HEAP16.set(frame, ptr >> 1);
    const result = this.module._fvad_process(this.inst, ptr, frame.length);
    this.module._free(ptr);
    return result === 1;
  }
}
