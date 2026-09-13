import { test, expect } from "bun:test";
import type { ClientMessage, ServerMessage } from "./index";
import { isClientMessage } from "./index";

test("offer message is well-formed", () => {
  const msg: ClientMessage = { type: "offer", sessionId: "s1", sdp: "v=0..." };
  expect(msg.type).toBe("offer");
});

test("ice_candidate can signal end-of-gathering with null", () => {
  const done: ClientMessage = { type: "ice_candidate", sessionId: "s1", candidate: null };
  expect(done.candidate).toBeNull();
});

test("error message can omit sessionId (pre-session failures)", () => {
  const err: ServerMessage = { type: "error", code: "invalid_message", message: "bad json" };
  expect(err.code).toBe("invalid_message");
});

test("isClientMessage accepts a valid offer", () => {
  expect(isClientMessage({ type: "offer", sessionId: "s1", sdp: "v=0..." })).toBe(true);
});

test("isClientMessage rejects garbage", () => {
  expect(isClientMessage(null)).toBe(false);
  expect(isClientMessage({})).toBe(false);
  expect(isClientMessage({ type: "bogus" })).toBe(false);
  expect(isClientMessage({ type: "offer", sessionId: "s1" })).toBe(false); // missing sdp
});
