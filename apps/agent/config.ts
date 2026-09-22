function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (add it to the repo-root .env)`);
  return v;
}

export const config = {
  groqApiKey: required("GROQ_API_KEY"),
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "llama-3.3-70b-versatile",
  },
  stt: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: process.env.STT_MODEL ?? "whisper-large-v3-turbo",
  },
  tts: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: process.env.TTS_MODEL ?? "playai-tts",
    voice: process.env.TTS_VOICE ?? "austin",
  },
  signalingUrl: process.env.SIGNALING_URL ?? "ws://localhost:8080",
};
