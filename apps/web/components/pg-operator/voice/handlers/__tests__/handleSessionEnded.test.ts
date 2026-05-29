import { describe, it, expect, vi } from "vitest";
import { handleSessionEnded } from "../handleSessionEnded";

function makeToast() {
  return { show: vi.fn() };
}

describe("handleSessionEnded", () => {
  it("shows the duration_cap copy when session timed out", () => {
    const toast = makeToast();
    handleSessionEnded({ reason: "duration_cap", draft_id: "d1", listing_id: null }, { toast });
    expect(toast.show).toHaveBeenCalledOnce();
    expect(toast.show.mock.calls[0][0].title).toMatch(/timed out/i);
    expect(toast.show.mock.calls[0][0].tone).toBe("warn");
  });

  it("shows idle_timeout copy with info tone", () => {
    const toast = makeToast();
    handleSessionEnded({ reason: "idle_timeout", draft_id: "d1", listing_id: null }, { toast });
    expect(toast.show.mock.calls[0][0].title).toMatch(/stopped listening/i);
    expect(toast.show.mock.calls[0][0].tone).toBe("info");
  });

  it("shows daily_cap copy", () => {
    const toast = makeToast();
    handleSessionEnded({ reason: "daily_cap", draft_id: "d1", listing_id: null }, { toast });
    expect(toast.show.mock.calls[0][0].title).toMatch(/daily voice/i);
  });

  it("stays silent when reason is user_end (operator clicked End)", () => {
    const toast = makeToast();
    handleSessionEnded({ reason: "user_end", draft_id: "d1", listing_id: "L-1" }, { toast });
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("falls back to disconnect copy on unknown reasons", () => {
    const toast = makeToast();
    handleSessionEnded({ reason: "anything_else", draft_id: "d1", listing_id: null }, { toast });
    expect(toast.show).toHaveBeenCalledOnce();
    expect(toast.show.mock.calls[0][0].title).toMatch(/lost connection/i);
    expect(toast.show.mock.calls[0][0].tone).toBe("error");
  });

  it.each([
    "tool_call_cap",
    "concurrent_cap",
    "audio_chunk_too_large",
    "rate_limited",
    "disconnect"
  ])("emits a toast for reason %s", (reason) => {
    const toast = makeToast();
    handleSessionEnded({ reason, draft_id: "d1", listing_id: null }, { toast });
    expect(toast.show).toHaveBeenCalledOnce();
    const args = toast.show.mock.calls[0][0];
    expect(args.title).toBeTruthy();
    expect(args.body).toBeTruthy();
    expect(["info", "warn", "error"]).toContain(args.tone);
  });
});
