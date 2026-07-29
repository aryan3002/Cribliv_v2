import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransferOwnerModal } from "../TransferOwnerModal";

describe("TransferOwnerModal", () => {
  // baseProps.onClose/onTransferred are shared vi.fn() instances reused (via
  // spread) across every case below. Without clearing between tests, a real
  // onClose() call from an earlier passing case (the successful-transfer
  // test) leaks into later assertions like "did not close on error".
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    listingId: "listing-1",
    currentOwnerName: "Adarsh Tripathi",
    currentOwnerPhone: "+918800826659",
    accessToken: "tok",
    onClose: vi.fn(),
    onTransferred: vi.fn()
  };

  it("does not submit an empty phone", () => {
    const onTransfer = vi.fn();
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("submits the phone as typed and lets the server normalise it", async () => {
    const onTransfer = vi.fn(async () => ({
      ownerUserId: "owner-9",
      ownerPhone: "+919956729103",
      leadsMoved: 0,
      alreadyOwned: false
    }));
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), {
      target: { value: "99567 29103" }
    });
    fireEvent.change(screen.getByLabelText(/owner's name/i), { target: { value: "Akash Rai" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() =>
      expect(onTransfer).toHaveBeenCalledWith("listing-1", "99567 29103", "Akash Rai")
    );
  });

  it("shows the server's rejection when the number is unusable", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error("Enter a valid Indian mobile number");
    });
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid indian mobile number/i)).toBeInTheDocument()
    );
  });

  it("warns that the callback number changes before confirming", () => {
    render(<TransferOwnerModal {...baseProps} onTransfer={vi.fn()} />);
    expect(screen.getByText(/callback number/i)).toBeInTheDocument();
  });

  it("surfaces a server error instead of closing", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error("That number belongs to an admin account");
    });
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), {
      target: { value: "9956729103" }
    });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() => expect(screen.getByText(/admin account/i)).toBeInTheDocument());
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });
});
