import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PgCaptureEntry from "../PgCaptureEntry";

describe("PgCaptureEntry", () => {
  it("renders both 'Type it myself' and 'Talk to list' cards", () => {
    render(<PgCaptureEntry onManual={vi.fn()} />);
    expect(screen.getByText(/type it myself/i)).toBeInTheDocument();
    expect(screen.getByText(/talk to list/i)).toBeInTheDocument();
  });

  it("selecting manual card calls onManual", () => {
    const onManual = vi.fn();
    render(<PgCaptureEntry onManual={onManual} />);
    fireEvent.click(screen.getByRole("button", { name: /type it myself/i }));
    expect(onManual).toHaveBeenCalled();
  });

  it("voice card is disabled when FF_PG_VOICE_LISTING is off", () => {
    render(<PgCaptureEntry onManual={vi.fn()} />);
    const voiceBtn = screen.getByRole("button", { name: /talk to list/i });
    expect(voiceBtn).toBeDisabled();
  });

  it("uses the responsive capture option grid instead of an inline fixed two-column style", () => {
    const { container } = render(<PgCaptureEntry onManual={vi.fn()} />);
    const options = container.querySelector(".pgo-capture-options");
    expect(options).toBeTruthy();
    expect(options).not.toHaveStyle({ gridTemplateColumns: "1fr 1fr" });
  });
});
