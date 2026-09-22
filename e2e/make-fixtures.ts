import { spawnSync } from "bun";
import { decodeWav, resamplePcm, encodeWav } from "../apps/agent/audio";

async function synth(phrase: string): Promise<Int16Array> {
  const tmp = "/tmp/aura-espeak-fixture.wav";
  const r = spawnSync(["espeak-ng", "-s", "150", "-w", tmp, phrase]);
  if (r.exitCode !== 0) throw new Error("espeak-ng failed; install espeak-ng");
  const bytes = new Uint8Array(await Bun.file(tmp).arrayBuffer());
  const { samples, sampleRate, channels } = decodeWav(bytes);
  const mono = channels > 1 ? samples.filter((_, i) => i % channels === 0) : samples;
  return resamplePcm(mono, sampleRate, 48000);
}

function silence(seconds: number): Int16Array {
  return new Int16Array(Math.floor(48000 * seconds));
}

function join(parts: Int16Array[]): Int16Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Int16Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function write(name: string, parts: Int16Array[]) {
  const path = new URL(`./${name}`, import.meta.url).pathname;
  await Bun.write(path, encodeWav(join(parts), 48000, 1));
  console.log(`wrote ${name}`);
}

await write("fake-mic.wav", [silence(0.4), await synth("What is the temperature in Delhi"), silence(3)]);
await write("fake-mic-booking.wav", [
  silence(0.4),
  await synth("Book a train from Delhi to Jaipur tomorrow morning at six"),
  silence(16),
  await synth("Actually cancel that"),
  silence(16),
]);
console.log("fixtures ready");
