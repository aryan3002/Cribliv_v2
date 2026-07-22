import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ListingAvailabilityToggle } from "../listing-availability-toggle";
import * as ownerApi from "../../../lib/owner-api";

// Mirrors the `useFlag` mocking pattern used by
// `lead-monetization-controls.test.tsx` for the sibling `ff_callback_leads`
// flag: this component self-hides behind `ff_unavailable_listings`, so the
// flag must be forced on for these tests to exercise the real UI.
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: true } as Record<string, boolean>
}));

vi.mock("../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("../../../lib/owner-api", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/owner-api")>("../../../lib/owner-api");
  return {
    ...actual,
    setListingAvailability: vi.fn()
  };
});

const setListingAvailabilityMock = vi.mocked(ownerApi.setListingAvailability);

beforeEach(() => {
  vi.clearAllMocks();
  flagState.ff_unavailable_listings = true;
});

describe("ListingAvailabilityToggle", () => {
  it("optimistically marks not available and calls the API", async () => {
    setListingAvailabilityMock.mockResolvedValue({ listing_id: "L1", is_available: false });
    render(<ListingAvailabilityToggle listingId="L1" accessToken="tok" available={true} />);

    const toggle = screen.getByRole("switch", { name: /availability/i });
    expect(screen.getByText("Available")).toBeInTheDocument();

    fireEvent.click(toggle);

    // Optimistic flip happens synchronously, before the mocked promise resolves.
    expect(screen.getByText("Not available")).toBeInTheDocument();
    await waitFor(() =>
      expect(setListingAvailabilityMock).toHaveBeenCalledWith("tok", "L1", false)
    );
  });

  it("reverts to available and shows an error when the API call fails", async () => {
    setListingAvailabilityMock.mockRejectedValue(new Error("Request failed with status 500"));
    const onAvailabilityChange = vi.fn();
    render(
      <ListingAvailabilityToggle
        listingId="L1"
        accessToken="tok"
        available={true}
        onAvailabilityChange={onAvailabilityChange}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: /availability/i }));

    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
    expect(screen.getByText(/couldn't update availability/i)).toBeInTheDocument();
    expect(onAvailabilityChange).not.toHaveBeenCalled();
  });

  it("renders nothing when ff_unavailable_listings is off", () => {
    flagState.ff_unavailable_listings = false;
    render(<ListingAvailabilityToggle listingId="L1" accessToken="tok" available={true} />);
    expect(screen.queryByRole("switch", { name: /availability/i })).not.toBeInTheDocument();
  });
});
