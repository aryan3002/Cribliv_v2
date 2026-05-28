import { describe, expect, it } from "vitest";
import { isTerminal, shouldPoll, statusLabel } from "../status-machine";

describe("status-machine", () => {
  it("isTerminal: generated, expired, refunded", () => {
    expect(isTerminal("generated")).toBe(true);
    expect(isTerminal("expired")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("paid")).toBe(false);
  });
  it("shouldPoll: any pre-terminal post-draft status", () => {
    expect(shouldPoll("pending_payment")).toBe(true);
    expect(shouldPoll("generating_pdf")).toBe(true);
    expect(shouldPoll("generated")).toBe(false);
    expect(shouldPoll("draft")).toBe(false);
  });
  it("statusLabel maps each to a human string", () => {
    expect(statusLabel("draft")).toMatch(/draft/i);
    expect(statusLabel("generated")).toMatch(/ready/i);
  });
});
