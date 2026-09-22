# AURA

A real-time, intent-driven voice agent. You talk to it in the browser; it understands, calls tools, keeps conversation state, and talks back — over a custom WebRTC SFU.

## Pipeline

```
Browser (mic + speaker)
  ⇄ WebRTC (audio both ways)
Signaling (ws)  ── relays SDP/ICE only
  ⇄
SFU (werift)    ── custom, forwards RTP browser⇄agent
  ⇄
Agent
  RTP → Opus decode → PCM (48k mono) → WebRTC VAD → TurnManager
      → utterance buffer → STT (Groq Whisper)
      → Orchestrator (conversation state + LLM tool-calling)
          → tools (real state + ids) → results → replan
      → TTS (Groq Orpheus) → Opus → RTP → SFU → Browser
```

Design boundaries: transport (SFU/agent WebRTC) is separate from audio processing, which is separate from the orchestrator (`apps/agent/orchestrator/*`, zero transport imports), which is separate from tools. The LLM decides; the tool state (`BookingStore`) is the source of truth.

## Run it

1. Put your Groq key in `.env` at the repo root (see `.env.example`):
   ```
   GROQ_API_KEY=gsk_...
   ```
   Get a free key at https://console.groq.com. One key covers STT + LLM + TTS.

2. Install and start everything (correct order, streamed logs):
   ```
   bun install
   bun run aura
   ```

3. Open http://localhost:3000, click **Connect & talk**, allow the mic, and speak.

### Enabling server-side voice (optional but recommended)
The Orpheus TTS model is terms-gated. Accept once at
https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english
and AURA's voice streams back through the SFU as real audio. Until then, AURA
still replies out loud using the browser's built-in voice (automatic fallback),
while STT + LLM + tools all run server-side.

## Frontend

`apps/client` is a single self-contained page: a status orb (idle / listening /
thinking / speaking), a live mic-level meter, a conversation transcript, and
connect/disconnect. It plays AURA's return audio from the SFU, and falls back to
the browser's built-in voice if server TTS isn't enabled. It exposes
`window.__AURA__` (connection/status/transcripts) so the end-to-end tests can
drive and assert against it.

## Test

```
bun run test          # unit tests: state machine, orchestrator, runtime, dedupe (33 tests)
bun run test:e2e      # real browser E2E with a fake mic (needs the stack running)
bun run check-types   # web/docs typecheck (turbo)
```

`bun run test:e2e` launches headless Chrome with a WAV file fed as the
microphone (`--use-file-for-fake-audio-capture`), clicks Connect, and asserts the
whole pipeline through `window.__AURA__`: WebRTC connects both ways, STT
transcribes, the LLM responds, tools run, and multi-turn book→cancel works — all
from the browser. Start the stack first (`bun run aura`).

> Note: the agent↔SFU peer connections are pinned away from unreachable Docker/
> link-local interfaces via an ICE candidate filter, so WebRTC connects reliably
> on machines with many virtual interfaces.

## Demo conversation

- "Book two tickets for Dune tomorrow at 8."
- "Actually cancel that."
- "Book a train from Delhi to Jaipur Friday morning at 6."
- "Wait, change that to Saturday."   ← correction/replan
- "What's the temperature in Delhi?" ← arbitrary question, weather tool
- "What's 15 percent of 240?"        ← arbitrary question, no tool
- Interrupt AURA while it's speaking  ← barge-in: it stops and listens

## Tools (mock, with real state + ids)

`search_movies`, `book_movie_ticket`, `cancel_movie_ticket`, `search_trains`,
`book_train`, `cancel_train_ticket`, `get_weather`. Bookings have explicit
statuses (`confirmed → cancelled`, `confirmed → committed`) with guards against
cancelling committed/already-cancelled bookings.

## Known limitations

- Single active conversation (one shared agent PC); fine for a single-user demo.
- Free-tier Groq is 8000 tokens/min; rapid-fire turns can pause a few seconds
  (handled with rate-limit-aware retry). Natural pacing is fine.
- Server TTS requires the one-time Orpheus terms acceptance above.
- Turn detection is VAD + silence hangover, not a semantic end-of-turn model.
