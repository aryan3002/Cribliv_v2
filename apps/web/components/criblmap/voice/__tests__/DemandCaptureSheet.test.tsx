import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DemandCaptureSheet } from "../DemandCaptureSheet";
import { postDemandSignal } from "../../../../lib/demand-api";

vi.mock("../../../../lib/demand-api", () => ({
  postDemandSignal: vi.fn().mockResolvedValue({ ok: true, id: "sig_1" })
}));

const postDemandSignalMock = vi.mocked(postDemandSignal);

describe("DemandCaptureSheet", () => {
  it("submits the prefilled spec and confirms", async () => {
    const onDone = vi.fn();
    render(
      <DemandCaptureSheet
        prefill={{
          city: "lucknow",
          locality: "Gomti Nagar",
          filters: { bhk: 2 },
          unmet: "parking"
        }}
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));
    await waitFor(() =>
      expect(postDemandSignalMock).toHaveBeenCalledWith(
        expect.objectContaining({ locality: "Gomti Nagar", unmet: "parking" })
      )
    );
  });
});
