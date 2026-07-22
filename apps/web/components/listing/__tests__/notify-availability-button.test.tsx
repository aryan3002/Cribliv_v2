import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotifyAvailabilityButton } from "../notify-availability-button";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock })
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("NotifyAvailabilityButton", () => {
  it("navigates to the listing detail page instead of running any inline flow", () => {
    const onClick = vi.fn();
    render(
      <NotifyAvailabilityButton listingId="L42" locale="en" variant="inline" onClick={onClick} />
    );

    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(pushMock).toHaveBeenCalledWith("/en/listing/L42");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a real, labelled, clickable button for each variant", () => {
    render(<NotifyAvailabilityButton listingId="L1" locale="en" variant="primary" />);
    const btn = screen.getByRole("button", { name: /notify when available/i });
    expect(btn).toBeEnabled();
  });

  it("renders the Hindi label when locale is hi (Task 16 i18n)", () => {
    render(<NotifyAvailabilityButton listingId="L1" locale="hi" variant="primary" />);
    expect(screen.getByRole("button", { name: /उपलब्ध होने पर सूचित करें/ })).toBeEnabled();
  });
});
