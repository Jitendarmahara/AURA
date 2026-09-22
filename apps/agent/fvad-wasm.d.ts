declare module "@echogarden/fvad-wasm" {
  export type FvadModule = {
    _fvad_new(): number;
    _fvad_set_mode(inst: number, mode: number): number;
    _fvad_set_sample_rate(inst: number, rate: number): number;
    _fvad_process(inst: number, ptr: number, len: number): number;
    _fvad_reset(inst: number): void;
    _fvad_free(inst: number): void;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    HEAP16: Int16Array;
  };
  const fvad: (moduleArg?: Record<string, unknown>) => Promise<FvadModule>;
  export default fvad;
}
