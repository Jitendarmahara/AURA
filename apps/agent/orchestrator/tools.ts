import type { Tool, ToolResult } from "./types";
import type { BookingStore, BookingKind } from "./state";
import { webSearch, fetchPageText, getWeather } from "./research";

const MOVIES = [
  { id: "mv_dune", title: "Dune: Part Two", theater: "PVR Icon", times: ["17:30", "20:00", "22:30"] },
  { id: "mv_oppen", title: "Oppenheimer", theater: "INOX Central", times: ["18:00", "20:15", "21:45"] },
  { id: "mv_gof", title: "Guardians of the Galaxy", theater: "Cinepolis", times: ["16:00", "19:00", "20:00"] },
];

const TRAINS = [
  { id: "tr_12045", name: "Shatabdi Express", from: "Delhi", to: "Jaipur", times: ["06:05", "14:30"] },
  { id: "tr_12958", name: "Rajdhani Express", from: "Delhi", to: "Jaipur", times: ["07:55", "19:20"] },
  { id: "tr_19711", name: "Jaipur Intercity", from: "Delhi", to: "Jaipur", times: ["11:40"] },
];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function ok(data: Record<string, unknown>): ToolResult {
  return { ok: true, data };
}
function fail(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function findMovie(q?: string) {
  if (!q) return undefined;
  const s = q.toLowerCase();
  return MOVIES.find((m) => m.title.toLowerCase().includes(s) || m.id === q);
}

function resolveLatest(store: BookingStore, kind: BookingKind, bookingId?: string) {
  if (bookingId) {
    const b = store.get(bookingId);
    return b ?? null;
  }
  return store.latest(kind) ?? null;
}

export function createTools(store: BookingStore): Tool[] {
  return [
    {
      spec: {
        name: "search_movies",
        description: "Search available movies and showtimes. Use before booking when the user has not named a specific movie.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional movie title to filter by" },
            city: { type: "string", description: "Optional city" },
            date: { type: "string", description: "Optional date such as 'tomorrow' or a date string" },
          },
        },
      },
      async run(args) {
        const q = str(args.query);
        const list = q ? MOVIES.filter((m) => m.title.toLowerCase().includes(q.toLowerCase())) : MOVIES;
        return ok({ date: str(args.date) ?? "today", city: str(args.city) ?? "your city", movies: list });
      },
    },
    {
      spec: {
        name: "book_movie_ticket",
        description: "Book movie tickets. Requires a movie, a showtime, and a ticket count. Returns a booking id.",
        parameters: {
          type: "object",
          properties: {
            movie: { type: "string", description: "Movie title or id" },
            theater: { type: "string" },
            date: { type: "string", description: "e.g. 'tomorrow'" },
            time: { type: "string", description: "Showtime, 24h like '20:00'" },
            count: { type: "number", description: "Number of tickets" },
          },
          required: ["movie", "time", "count"],
        },
      },
      async run(args) {
        const movie = findMovie(str(args.movie));
        if (!movie) return fail("unknown_movie", `no movie matching '${String(args.movie)}'. Call search_movies first.`);
        const time = str(args.time);
        const count = num(args.count);
        if (!time) return fail("missing_time", "a showtime is required");
        if (!count || count < 1) return fail("missing_count", "number of tickets is required");
        const date = str(args.date) ?? "today";
        const summary = `${count} ticket(s) for ${movie.title} at ${movie.theater}, ${date} ${time}`;
        const booking = store.create("movie", summary, {
          movie: movie.title,
          theater: str(args.theater) ?? movie.theater,
          date,
          time,
          count,
        });
        return ok({ bookingId: booking.id, status: booking.status, summary });
      },
    },
    {
      spec: {
        name: "cancel_movie_ticket",
        description: "Cancel a movie booking. If bookingId is omitted, cancels the most recent confirmed movie booking (use for 'cancel that').",
        parameters: {
          type: "object",
          properties: { bookingId: { type: "string", description: "Optional booking id" } },
        },
      },
      async run(args) {
        const booking = resolveLatest(store, "movie", str(args.bookingId));
        if (!booking) return fail("no_booking", "there is no movie booking to cancel");
        const res = store.cancel(booking.id);
        if (!res.ok) return fail(res.code, res.message);
        return ok({ bookingId: res.booking.id, status: res.booking.status, summary: res.booking.summary });
      },
    },
    {
      spec: {
        name: "search_trains",
        description: "Search trains between two cities. Requires from and to.",
        parameters: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            date: { type: "string" },
            time: { type: "string", description: "Optional preferred time of day" },
          },
          required: ["from", "to"],
        },
      },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        if (!from || !to) return fail("missing_route", "both from and to cities are required");
        const list = TRAINS.filter(
          (t) => t.from.toLowerCase() === from.toLowerCase() && t.to.toLowerCase() === to.toLowerCase(),
        );
        return ok({ from, to, date: str(args.date) ?? "today", trains: list.length ? list : TRAINS });
      },
    },
    {
      spec: {
        name: "book_train",
        description: "Book a train seat. Requires from, to, date and a time. Returns a booking id.",
        parameters: {
          type: "object",
          properties: {
            train: { type: "string", description: "Train name or id" },
            from: { type: "string" },
            to: { type: "string" },
            date: { type: "string" },
            time: { type: "string" },
            count: { type: "number" },
          },
          required: ["from", "to", "date", "time"],
        },
      },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        const date = str(args.date);
        const time = str(args.time);
        if (!from || !to) return fail("missing_route", "both from and to cities are required");
        if (!date) return fail("missing_date", "a travel date is required");
        if (!time) return fail("missing_time", "a departure time is required");
        const count = num(args.count) ?? 1;
        const named = str(args.train);
        const train =
          TRAINS.find((t) => named && (t.name.toLowerCase().includes(named.toLowerCase()) || t.id === named)) ??
          TRAINS.find((t) => t.from.toLowerCase() === from.toLowerCase() && t.to.toLowerCase() === to.toLowerCase());
        const label = train ? train.name : "the next available train";
        const summary = `${count} seat(s) on ${label} from ${from} to ${to}, ${date} ${time}`;
        const booking = store.create("train", summary, { train: label, from, to, date, time, count });
        return ok({ bookingId: booking.id, status: booking.status, summary });
      },
    },
    {
      spec: {
        name: "cancel_train_ticket",
        description: "Cancel a train booking. If bookingId is omitted, cancels the most recent confirmed train booking.",
        parameters: {
          type: "object",
          properties: { bookingId: { type: "string" } },
        },
      },
      async run(args) {
        const booking = resolveLatest(store, "train", str(args.bookingId));
        if (!booking) return fail("no_booking", "there is no train booking to cancel");
        const res = store.cancel(booking.id);
        if (!res.ok) return fail(res.code, res.message);
        return ok({ bookingId: res.booking.id, status: res.booking.status, summary: res.booking.summary });
      },
    },
    {
      spec: {
        name: "get_weather",
        description: "Get the REAL current temperature and conditions for a city from a live weather service. Use for any weather or temperature question.",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
      async run(args, signal) {
        const city = str(args.city);
        if (!city) return fail("missing_city", "which city?");
        try {
          const w = await getWeather(city, signal);
          return ok({ ...w });
        } catch (err) {
          return fail("weather_failed", err instanceof Error ? err.message : "weather lookup failed");
        }
      },
    },
    {
      spec: {
        name: "web_search",
        description:
          "Search the live web for up-to-date information on ANY topic (facts, news, prices, people, places, definitions). Returns titles, URLs and snippets. Use this whenever the user asks about something real that you should look up rather than guess.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "What to search for" } },
          required: ["query"],
        },
      },
      async run(args, signal) {
        const query = str(args.query);
        if (!query) return fail("missing_query", "what should I search for?");
        try {
          const results = await webSearch(query, signal);
          if (!results.length) return ok({ query, results: [], note: "no results found" });
          return ok({ query, results });
        } catch (err) {
          return fail("search_failed", err instanceof Error ? err.message : "search failed");
        }
      },
    },
    {
      spec: {
        name: "fetch_page",
        description:
          "Fetch the readable text of a specific web page URL. Use after web_search to read a promising result, or when the user names a site, to pull the actual details.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "The full http(s) URL to read" } },
          required: ["url"],
        },
      },
      async run(args, signal) {
        const url = str(args.url);
        if (!url || !/^https?:\/\//.test(url)) return fail("bad_url", "a full http(s) URL is required");
        try {
          const text = await fetchPageText(url, signal);
          return ok({ url, text });
        } catch (err) {
          return fail("fetch_failed", err instanceof Error ? err.message : "page fetch failed");
        }
      },
    },
  ];
}
