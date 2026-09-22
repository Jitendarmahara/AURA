export type AudioChunk = {
  data: Buffer;
  timestamp: number;
  payloadType: number;
};

type AudioHandler = (chunk: AudioChunk) => void;

export class AudioInput {
  private handlers: AudioHandler[] = [];

  onAudio(handler: AudioHandler): void {
    this.handlers.push(handler);
  }

  push(chunk: AudioChunk): void {
    for (const handler of this.handlers) handler(chunk);
  }
}
