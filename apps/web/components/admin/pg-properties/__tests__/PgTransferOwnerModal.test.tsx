import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PgTransferOwnerModal } from "../PgTransferOwnerModal";

const baseProps = {
  listingId: "ad204234-4b39-4228-8b49-3b9e91113e16",
  currentOwnerName: "Old Operator",
  currentOwnerPhone: "+919999999901",
  onClose: vi.fn(),
  onTransferred: vi.fn()
};

describe("PgTransferOwnerModal", () => {
  it("refuses to submit an empty phone without calling the server", async () => {
    const onTransfer = vi.fn();
    render(<PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the operator's phone number");
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("posts the raw typed phone — validation is the server's job", async () => {
    const onTransfer = vi.fn(async () => ({
      operatorUserId: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operatorPhone: "+919956729103",
      leadsMoved: 0,
      alreadyOwned: false
    }));
    const onTransferred = vi.fn();
    render(
      <PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} onTransferred={onTransferred} />
    );

    await userEvent.type(screen.getByLabelText(/operator's phone/i), "99567 29103");
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(onTransfer).toHaveBeenCalledWith(baseProps.listingId, "99567 29103", undefined);
    expect(onTransferred).toHaveBeenCalledWith({
      operatorPhone: "+919956729103",
      leadsMoved: 0
    });
  });

  it("renders the server's rejection instead of guessing at validity", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error(
        "That number belongs to a flat/house owner account. Change their role first, or use a different number."
      );
    });
    render(<PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    await userEvent.type(screen.getByLabelText(/operator's phone/i), "9956729103");
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/flat\/house owner account/i);
  });

  it("warns that tenants and ops data move with the PG", () => {
    render(<PgTransferOwnerModal {...baseProps} onTransfer={vi.fn()} />);
    expect(screen.getByText(/rooms, beds, tenants and maintenance/i)).toBeInTheDocument();
  });
});
