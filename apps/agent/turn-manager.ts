export type TurnEvent = "SPEECH_STARTED" | "TURN_ENDED";

type TurnHandler = (event: TurnEvent) => void;

export class TurnManager {
  private speaking = false;
  private silenceFrames = 0;
  private onsetFrames = 0;
  private voiced = 0;
  private handlers: TurnHandler[] = [];

  constructor(
    private silenceHangover = 25,
    private minOnsetFrames = 3,
  ) {}

  onEvent(handler: TurnHandler): void {
    this.handlers.push(handler);
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get voicedFrames(): number {
    return this.voiced;
  }

  reset(): void {
    this.speaking = false;
    this.silenceFrames = 0;
    this.onsetFrames = 0;
    this.voiced = 0;
  }

  process(isSpeech: boolean): void {
    if (!this.speaking) {
      if (isSpeech) {
        this.onsetFrames++;
        if (this.onsetFrames >= this.minOnsetFrames) {
          this.speaking = true;
          this.silenceFrames = 0;
          this.voiced = this.onsetFrames;
          this.emit("SPEECH_STARTED");
        }
      } else {
        this.onsetFrames = 0;
      }
      return;
    }

    if (isSpeech) {
      this.silenceFrames = 0;
      this.voiced++;
    } else {
      this.silenceFrames++;
      if (this.silenceFrames >= this.silenceHangover) {
        this.speaking = false;
        this.onsetFrames = 0;
        this.emit("TURN_ENDED");
      }
    }
  }

  private emit(event: TurnEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
