import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RoomTypeCard from "../RoomTypeCard";

const room = {
  sharing: "double" as const,
  ac: false,
  monthly_rent_paise: 800000,
  vacancy_count: 3
};

describe("RoomTypeCard", () => {
  it("renders rent in rupees and toggles AC", () => {
    const onChange = vi.fn();
    render(<RoomTypeCard room={room} onChange={onChange} onRemove={() => {}} />);
    expect(screen.getByText(/8,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ac/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ac: true }));
  });
  it("fires onRemove", () => {
    const onRemove = vi.fn();
    render(<RoomTypeCard room={room} onChange={() => {}} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
