import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock PgVoicePanel module: next/dynamic will pick this up via the
// dynamic `import("./PgVoicePanel")` call inside the orb component.
vi.mock("../PgVoicePanel", () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="mock-panel">
      <button onClick={onClose}>Close mock</button>
    </div>
  )
}));

import PgVoiceOrb from "../PgVoiceOrb";
import { initialPgWizardState } from "@/lib/pg-wizard-state";

const baseState = () => initialPgWizardState();

describe("PgVoiceOrb", () => {
  it("renders the FAB with idle state by default", () => {
    render(
      <PgVoiceOrb
        state={baseState()}
        dispatch={vi.fn()}
        locale="en"
        userId="00000000-0000-0000-0000-000000000001"
      />
    );
    const btn = screen.getByRole("button", { name: /chaya|voice/i });
    expect(btn).toHaveAttribute("data-state", "idle");
  });

  it("opens the panel on click (next/dynamic resolved lazily)", async () => {
    render(
      <PgVoiceOrb
        state={baseState()}
        dispatch={vi.fn()}
        locale="en"
        userId="00000000-0000-0000-0000-000000000001"
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /chaya|voice/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("closes the panel when its onClose is invoked", async () => {
    render(
      <PgVoiceOrb
        state={baseState()}
        dispatch={vi.fn()}
        locale="en"
        userId="00000000-0000-0000-0000-000000000001"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /chaya|voice/i }));
    const closeBtn = await screen.findByRole("button", { name: /close mock/i });
    fireEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not render the dialog before the FAB is clicked", () => {
    render(
      <PgVoiceOrb
        state={baseState()}
        dispatch={vi.fn()}
        locale="en"
        userId="00000000-0000-0000-0000-000000000001"
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
