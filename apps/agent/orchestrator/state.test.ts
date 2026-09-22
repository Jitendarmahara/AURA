import { test, expect } from "bun:test";
import { BookingStore } from "./state";

function store() {
  let n = 0;
  return new BookingStore(() => `b${++n}`);
}

test("create() yields a confirmed booking with an id", () => {
  const s = store();
  const b = s.create("movie", "2 for Dune", { count: 2 });
  expect(b.id).toBe("b1");
  expect(b.status).toBe("confirmed");
});

test("cancel() moves confirmed -> cancelled", () => {
  const s = store();
  const b = s.create("movie", "x", {});
  const res = s.cancel(b.id);
  expect(res.ok).toBe(true);
  expect(s.get(b.id)!.status).toBe("cancelled");
});

test("cancel() twice is guarded (already_cancelled)", () => {
  const s = store();
  const b = s.create("movie", "x", {});
  s.cancel(b.id);
  const again = s.cancel(b.id);
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.code).toBe("already_cancelled");
});

test("committed bookings cannot be cancelled", () => {
  const s = store();
  const b = s.create("train", "x", {});
  expect(s.commit(b.id).ok).toBe(true);
  const res = s.cancel(b.id);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.code).toBe("committed");
});

test("latest() returns the most recent confirmed booking of a kind and skips cancelled", () => {
  const s = store();
  const b1 = s.create("movie", "first", {});
  const b2 = s.create("movie", "second", {});
  expect(s.latest("movie")!.id).toBe(b2.id);
  s.cancel(b2.id);
  expect(s.latest("movie")!.id).toBe(b1.id);
  s.create("train", "t", {});
  expect(s.latest("movie")!.id).toBe(b1.id);
});

test("cancel() of unknown id reports not_found", () => {
  const res = store().cancel("nope");
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.code).toBe("not_found");
});
