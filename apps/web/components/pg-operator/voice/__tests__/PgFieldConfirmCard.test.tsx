import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PgFieldConfirmCard } from "../PgFieldConfirmCard";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, initial: _i, animate: _a, transition: _t, ...rest }: any) => (
      <div {...rest}>{children}</div>
    )
  }
}));

describe("PgFieldConfirmCard", () => {
  it("renders a human label, the value, a confidence chip and an Undo button", () => {
    const onUndo = vi.fn();
    render(
      <PgFieldConfirmCard
        field="property.display_name"
        value="Sunrise PG"
        confidence={0.92}
        onUndo={onUndo}
      />
    );
    expect(screen.getByText(/PG name/i)).toBeTruthy();
    expect(screen.getByText("Sunrise PG")).toBeTruthy();
    expect(screen.getByText(/92%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledWith("property.display_name");
  });

  it("formats *_paise values as rupees", () => {
    render(
      <PgFieldConfirmCard
        field="pg_details.security_deposit_paise"
        value={1500000}
        confidence={0.8}
        onUndo={() => {}}
      />
    );
    expect(screen.getByText(/₹15,000/)).toBeTruthy();
  });

  it("shows a 'Please confirm' affordance when confidence < 0.6", () => {
    render(
      <PgFieldConfirmCard
        field="property.city_slug"
        value="lucknow"
        confidence={0.4}
        onUndo={() => {}}
      />
    );
    expect(screen.getByText(/please confirm/i)).toBeTruthy();
  });
});
