const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export type SearchResult = { title: string; url: string; snippet: string };

export async function webSearch(query: string, signal?: AbortSignal, limit = 4): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal,
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  const html = await res.text();

  const anchors = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs)].map((m) => stripTags(m[1]!));

  const results: SearchResult[] = [];
  for (let i = 0; i < anchors.length && results.length < limit; i++) {
    const rawHref = anchors[i]![1]!;
    const title = stripTags(anchors[i]![2]!);
    let url = rawHref;
    const uddg = rawHref.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    else if (url.startsWith("//")) url = "https:" + url;
    if (!title || !url.startsWith("http")) continue;
    results.push({ title, url, snippet: (snippets[i] ?? "").slice(0, 200) });
  }
  return results;
}

export async function fetchPageText(url: string, signal?: AbortSignal, maxChars = 1500): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal, redirect: "follow" });
  if (!res.ok) throw new Error(`fetch http ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!type.includes("html")) return body.slice(0, maxChars);
  const cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");
  return stripTags(cleaned).slice(0, maxChars);
}

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog", 51: "light drizzle", 53: "drizzle", 55: "dense drizzle",
  56: "freezing drizzle", 57: "dense freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  77: "snow grains", 80: "light rain showers", 81: "rain showers", 82: "violent rain showers",
  85: "light snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

export type Weather = {
  city: string;
  country?: string;
  temperatureC: number;
  feelsLikeC?: number;
  conditions: string;
  humidity?: number;
  windKph?: number;
};

export async function getWeather(city: string, signal?: AbortSignal): Promise<Weather> {
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, { signal });
  if (!geo.ok) throw new Error(`geocode http ${geo.status}`);
  const g = (await geo.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
  const place = g.results?.[0];
  if (!place) throw new Error(`could not find a place named '${city}'`);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`;
  const fc = await fetch(url, { signal });
  if (!fc.ok) throw new Error(`forecast http ${fc.status}`);
  const f = (await fc.json()) as {
    current?: { temperature_2m: number; apparent_temperature?: number; relative_humidity_2m?: number; wind_speed_10m?: number; weather_code?: number };
  };
  const c = f.current;
  if (!c) throw new Error("no current weather");
  return {
    city: place.name,
    country: place.country,
    temperatureC: Math.round(c.temperature_2m),
    feelsLikeC: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : undefined,
    conditions: WMO[c.weather_code ?? -1] ?? "unknown",
    humidity: c.relative_humidity_2m,
    windKph: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : undefined,
  };
}
