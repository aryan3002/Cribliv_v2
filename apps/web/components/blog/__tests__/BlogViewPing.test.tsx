import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { BlogViewPing } from "../BlogViewPing";

describe("BlogViewPing", () => {
  const sendBeacon = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
      writable: true
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires exactly one beacon to the post's view endpoint", () => {
    const { rerender } = render(<BlogViewPing slug="rooms-for-rent-near-me" />);
    rerender(<BlogViewPing slug="rooms-for-rent-near-me" />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(String(sendBeacon.mock.calls[0][0])).toContain("/blog/rooms-for-rent-near-me/view");
  });

  it("renders nothing", () => {
    const { container } = render(<BlogViewPing slug="x" />);
    expect(container.innerHTML).toBe("");
  });
});
