import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PgVoiceFallbackInput from "../PgVoiceFallbackInput";

describe("PgVoiceFallbackInput", () => {
  it("sends typed text on Send click", () => {
    const onSend = vi.fn();
    render(<PgVoiceFallbackInput onSend={onSend} />);
    fireEvent.change(screen.getByLabelText(/text input/i), {
      target: { value: "We have 12 beds" }
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("We have 12 beds");
  });

  it("trims whitespace before sending", () => {
    const onSend = vi.fn();
    render(<PgVoiceFallbackInput onSend={onSend} />);
    fireEvent.change(screen.getByLabelText(/text input/i), {
      target: { value: "   hello   " }
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does NOT send empty / whitespace-only input", () => {
    const onSend = vi.fn();
    render(<PgVoiceFallbackInput onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/text input/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the input after a successful send", () => {
    const onSend = vi.fn();
    render(<PgVoiceFallbackInput onSend={onSend} />);
    const input = screen.getByLabelText(/text input/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12 beds" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(input.value).toBe("");
  });
});
