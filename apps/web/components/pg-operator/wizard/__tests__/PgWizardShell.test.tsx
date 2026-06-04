import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PgWizardShell from "../PgWizardShell";

describe("PgWizardShell", () => {
  it("disables Back on step 1 and advances on Next", () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <PgWizardShell
        step={1}
        onNext={onNext}
        onBack={onBack}
        onSubmit={() => {}}
        saving={false}
        indicator={<div />}
        rail={<div>rail</div>}
      >
        <div>form body</div>
      </PgWizardShell>
    );
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalled();
  });
  it("shows Submit on the last step (7) instead of Next", () => {
    const onSubmit = vi.fn();
    render(
      <PgWizardShell
        step={7}
        onNext={() => {}}
        onBack={() => {}}
        onSubmit={onSubmit}
        saving={false}
        indicator={<div />}
        rail={<div />}
      >
        <div />
      </PgWizardShell>
    );
    expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
