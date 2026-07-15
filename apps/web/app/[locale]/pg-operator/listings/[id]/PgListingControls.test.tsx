import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/toast-provider";
import { setPgListingStatus } from "@/lib/pg-operator-api";
import PgListingControls from "./PgListingControls";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/pg-operator-api", () => ({ setPgListingStatus: vi.fn() }));

describe("PgListingControls", () => {
  it("offers a Retry toast action that reapplies a failed status change", async () => {
    vi.mocked(setPgListingStatus).mockRejectedValueOnce(new Error("Status update failed"));
    vi.mocked(setPgListingStatus).mockResolvedValueOnce(undefined as never);

    render(
      <ToastProvider>
        <PgListingControls listingId="listing-1" status="active" locale="en" token="token" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(setPgListingStatus).toHaveBeenCalledTimes(2));
    expect(setPgListingStatus).toHaveBeenLastCalledWith("listing-1", "paused", "token");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
