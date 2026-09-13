import { test, expect } from "bun:test";
import { SessionManager } from "./session-manager";

test("create() returns a session with an id and initial state 'new'", () => {
  const mgr = new SessionManager();
  const s = mgr.create();
  expect(s.sessionId).toBeString();
  expect(s.sessionId.length).toBeGreaterThan(0);
  expect(s.state).toBe("new");
});

test("two create() calls produce different ids", () => {
  const mgr = new SessionManager();
  expect(mgr.create().sessionId).not.toBe(mgr.create().sessionId);
});

test("get() finds a created session and returns undefined for unknown ids", () => {
  const mgr = new SessionManager();
  const s = mgr.create();
  expect(mgr.get(s.sessionId)).toBe(s);
  expect(mgr.get("nope")).toBeUndefined();
});

test("remove() removes a session and reports whether one existed", () => {
  const mgr = new SessionManager();
  const s = mgr.create();
  expect(mgr.remove(s.sessionId)).toBe(true);
  expect(mgr.get(s.sessionId)).toBeUndefined();
  expect(mgr.remove("nope")).toBe(false);
});
