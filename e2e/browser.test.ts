import { test, expect } from "bun:test";
import puppeteer, { type Browser } from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ??
  new URL("../chrome/linux-153.0.8010.52/chrome-linux64/chrome", import.meta.url).pathname;
const URL_APP = process.env.APP_URL ?? "http://localhost:3000";

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, label: string): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await Bun.sleep(300);
  }
}

async function launch(wavPath: string): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wavPath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

async function aura(page: import("puppeteer-core").Page) {
  return page.evaluate(() => (window as any).__AURA__);
}

test("client is reachable", async () => {
  const ok = await fetch(URL_APP).then((r) => r.ok).catch(() => false);
  if (!ok) throw new Error(`client not reachable at ${URL_APP} — start the stack with 'bun run aura'`);
  expect(ok).toBe(true);
});

test(
  "single turn: mic -> SFU -> agent -> STT -> LLM (tool) -> response + return track",
  async () => {
    const wav = new URL("./fake-mic.wav", import.meta.url).pathname;
    const browser = await launch(wav);
    try {
      const page = await browser.newPage();
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.goto(URL_APP, { waitUntil: "domcontentloaded" });
      await page.click("#connect");

      await waitFor(() => page.evaluate(() => (window as any).__AURA__?.connected === true), 20000, "WebRTC connected");
      console.log("✓ WebRTC connected (browser <-> SFU)");
      await waitFor(() => page.evaluate(() => (window as any).__AURA__?.gotRemoteAudio === true), 10000, "return track");
      console.log("✓ return audio track received (SFU -> browser)");

      const user = await waitFor(() => page.evaluate(() => (window as any).__AURA__?.user?.[0] ?? null), 45000, "STT");
      console.log("✓ STT:", JSON.stringify(user));
      const reply = await waitFor(() => page.evaluate(() => (window as any).__AURA__?.aura?.[0] ?? null), 45000, "LLM reply");
      console.log("✓ AURA:", JSON.stringify(reply));

      const s = await aura(page);
      expect((user as string).length).toBeGreaterThan(0);
      expect((reply as string).length).toBeGreaterThan(0);
      expect((s.errors as string[]).filter((e) => !/orpheus|tts|terms/i.test(e))).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  90000,
);

test(
  "multi-turn by voice: book a train, then 'cancel that'",
  async () => {
    const wav = new URL("./fake-mic-booking.wav", import.meta.url).pathname;
    const browser = await launch(wav);
    try {
      const page = await browser.newPage();
      await page.goto(URL_APP, { waitUntil: "domcontentloaded" });
      await page.click("#connect");

      await waitFor(() => page.evaluate(() => (window as any).__AURA__?.connected === true), 20000, "WebRTC connected");

      await waitFor(() => page.evaluate(() => (window as any).__AURA__?.aura?.length >= 1), 60000, "first reply (booking)");
      const afterFirst = await aura(page);
      console.log("✓ turn 1 —", JSON.stringify(afterFirst.user[0]), "=>", JSON.stringify(afterFirst.aura[0]));

      await waitFor(() => page.evaluate(() => (window as any).__AURA__?.aura?.length >= 2), 60000, "second reply (cancel)");
      const afterSecond = await aura(page);
      console.log("✓ turn 2 —", JSON.stringify(afterSecond.user[1]), "=>", JSON.stringify(afterSecond.aura[1]));

      expect(afterSecond.user.length).toBeGreaterThanOrEqual(2);
      expect(afterSecond.aura.length).toBeGreaterThanOrEqual(2);
      expect(/cancel/i.test(afterSecond.aura[1])).toBe(true);
    } finally {
      await browser.close();
    }
  },
  160000,
);
