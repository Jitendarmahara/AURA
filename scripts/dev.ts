import { spawn } from "bun";

type Service = { name: string; color: string; cmd: string[]; delayMs: number };

const services: Service[] = [
  { name: "signaling", color: "\x1b[36m", cmd: ["bun", "run", "apps/signaling/index.ts"], delayMs: 0 },
  { name: "agent", color: "\x1b[35m", cmd: ["bun", "run", "apps/agent/index.ts"], delayMs: 800 },
  { name: "sfu", color: "\x1b[33m", cmd: ["bun", "run", "apps/sfu/index.ts"], delayMs: 800 },
  { name: "client", color: "\x1b[32m", cmd: ["bun", "run", "apps/client/server.ts"], delayMs: 400 },
];

const reset = "\x1b[0m";
const root = new URL("..", import.meta.url).pathname;
const procs: ReturnType<typeof spawn>[] = [];

function pipe(name: string, color: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) console.log(`${color}[${name}]${reset} ${line}`);
    }
  })();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function shutdown() {
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const svc of services) {
  if (svc.delayMs) await sleep(svc.delayMs);
  const proc = spawn({ cmd: svc.cmd, cwd: root, stdout: "pipe", stderr: "pipe", env: process.env });
  procs.push(proc);
  pipe(svc.name, svc.color, proc.stdout);
  pipe(svc.name, svc.color, proc.stderr);
  console.log(`${svc.color}[${svc.name}]${reset} started`);
}

console.log("\n\x1b[1mAURA is up — open http://localhost:3000 and click Connect & talk\x1b[0m\n");
await new Promise(() => {});
