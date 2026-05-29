import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  segment: vi.fn()
}));

vi.mock("@/lib/pg-operator-api", () => ({ segment: mocks.segment }));

import PgSegmentForm from "../PgSegmentForm";

beforeEach(() => {
  mocks.segment.mockReset();
});

describe("PgSegmentForm", () => {
  it("routes to /listings/new when self_serve (≤29 beds)", async () => {
    mocks.segment.mockResolvedValueOnce({
      path: "self_serve",
      reason: "ok",
      next_step: "/pg-operator/listings/new"
    });
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(mocks.segment).toHaveBeenCalledWith({ total_beds: 12 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/pg-operator/listings/new"));
  });

  it("routes to /onboarding/lead when sales_assist (≥30 beds)", async () => {
    mocks.segment.mockResolvedValueOnce({
      path: "sales_assist",
      reason: "ok",
      next_step: "/pg-operator/onboarding/lead"
    });
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/pg-operator/onboarding/lead"));
  });

  it("rejects out-of-range bed counts (0 and 501)", async () => {
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/1.*500/);
    expect(mocks.segment).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "501" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(mocks.segment).not.toHaveBeenCalled();
  });

  it("rejects non-integer input (e.g. empty string)", () => {
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/1.*500/);
    expect(mocks.segment).not.toHaveBeenCalled();
  });

  it("surfaces API errors as an alert", async () => {
    mocks.segment.mockRejectedValueOnce(new Error("network down"));
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network down/i));
    expect(push).not.toHaveBeenCalled();
  });

  it("disables the Continue button while busy", async () => {
    let resolve!: (v: any) => void;
    mocks.segment.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const push = vi.fn();
    render(<PgSegmentForm locale="en" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled());
    resolve({ path: "self_serve", reason: "ok", next_step: "/x" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled()
    );
  });

  it("prepends locale to next_step from API response", async () => {
    mocks.segment.mockResolvedValueOnce({
      path: "self_serve",
      reason: "ok",
      next_step: "/pg-operator/listings/new"
    });
    const push = vi.fn();
    render(<PgSegmentForm locale="hi" router={{ push } as any} />);
    fireEvent.change(screen.getByLabelText(/total beds/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hi/pg-operator/listings/new"));
  });
});
