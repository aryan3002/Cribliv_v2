import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BasicsStep } from "../BasicsStep";
import { EMPTY_FORM } from "../types";

/**
 * Finding 4 (2026-07-28 review): BasicsStep always offered "PG / Hostel", but
 * admin-listing-transfer.service.ts's publish-on-behalf hard-rejects PG
 * listings with pg_not_supported — offering the choice in admin mode let a
 * worker fill all six steps, including photo uploads, and hit an
 * unrecoverable dead end at publish. `pgOptionEnabled` is threaded in from
 * ListingWizard's `mode` prop (`pgOptionEnabled={mode !== "admin"}`), so this
 * covers the component's own contract directly rather than re-driving the
 * whole wizard to step 0 just to read a <select>.
 */
describe("BasicsStep — PG option visibility", () => {
  it("defaults to offering PG / Hostel when the prop is omitted entirely", () => {
    render(<BasicsStep form={EMPTY_FORM} errors={[]} updateField={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Flat / House" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PG / Hostel" })).toBeInTheDocument();
  });

  it('offers PG / Hostel when explicitly enabled — owner mode\'s wiring (mode !== "admin")', () => {
    render(
      <BasicsStep form={EMPTY_FORM} errors={[]} updateField={vi.fn()} pgOptionEnabled={true} />
    );

    expect(screen.getByRole("option", { name: "PG / Hostel" })).toBeInTheDocument();
  });

  it('hides PG / Hostel when explicitly disabled — admin mode\'s wiring (mode === "admin")', () => {
    render(
      <BasicsStep form={EMPTY_FORM} errors={[]} updateField={vi.fn()} pgOptionEnabled={false} />
    );

    expect(screen.queryByRole("option", { name: "PG / Hostel" })).not.toBeInTheDocument();
    // Flat/House is unaffected — admin mode isn't losing the property type
    // selector entirely, just the one option it can never actually publish.
    expect(screen.getByRole("option", { name: "Flat / House" })).toBeInTheDocument();
  });
});
