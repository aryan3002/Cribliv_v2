import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import PgVoiceTimer from "../PgVoiceTimer";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PgVoiceTimer", () => {
  it("renders 5:00 at session start", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
  });

  it("counts down 1 minute → 4:00", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("4:00");
  });

  it("counts down to 0:00 after 5 minutes (no negative)", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  });

  it("clamps at 0:00 even beyond 5 minutes", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  });

  it("zero-pads seconds (4:09 not 4:9)", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(51_000); // 4:09 left
    });
    expect(screen.getByRole("timer")).toHaveTextContent("4:09");
  });

  it("tone=info at start", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    expect(screen.getByRole("timer")).toHaveAttribute("data-tone", "info");
  });

  it("tone=warn at <60s remaining", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 30 * 1000); // 30s left
    });
    expect(screen.getByRole("timer")).toHaveAttribute("data-tone", "warn");
  });

  it("tone=danger at <15s remaining", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<PgVoiceTimer startedAt={now} />);
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 50 * 1000); // 10s left
    });
    expect(screen.getByRole("timer")).toHaveAttribute("data-tone", "danger");
  });

  it("clears its interval on unmount (no leaks)", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const { unmount } = render(<PgVoiceTimer startedAt={now} />);
    const before = vi.getTimerCount();
    unmount();
    const after = vi.getTimerCount();
    expect(after).toBe(before - 1);
  });
});
