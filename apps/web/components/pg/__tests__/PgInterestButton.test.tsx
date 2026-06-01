import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const expressPgInterest = vi.fn();
let __session: { access_token: string } | null = null;

vi.mock("next/navigation", () => ({ usePathname: () => "/en/pg/lucknow/abc" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("../../../lib/client-auth", () => ({ readAuthSession: () => __session }));
vi.mock("../../../lib/pg-public-api", () => ({
  expressPgInterest: (...a: unknown[]) => expressPgInterest(...a)
}));

import { PgInterestButton } from "../PgInterestButton";

beforeEach(() => {
  expressPgInterest.mockReset();
  __session = null;
});

describe("PgInterestButton", () => {
  it("shows a login link when logged out", () => {
    render(<PgInterestButton listingId="abc" locale="en" />);
    const link = screen.getByRole("link", { name: /log in/i });
    expect(link.getAttribute("href")).toContain("/en/auth/login");
  });

  it("posts interest and shows success copy when logged in", async () => {
    __session = { access_token: "tok_1" };
    expressPgInterest.mockResolvedValue({ interested: true, created: true, lead_id: "l1" });
    render(<PgInterestButton listingId="abc" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));
    await waitFor(() => expect(screen.getByText(/has your interest/i)).toBeTruthy());
    expect(expressPgInterest).toHaveBeenCalledWith("abc", "tok_1");
  });

  it("shows an error (not success) when the lead was not recorded", async () => {
    __session = { access_token: "tok_1" };
    expressPgInterest.mockResolvedValue({ interested: true, created: false });
    render(<PgInterestButton listingId="abc" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));
    await waitFor(() => expect(screen.getByText(/couldn.?t send your interest/i)).toBeTruthy());
    expect(screen.queryByText(/has your interest/i)).toBeNull();
  });

  it("shows a neutral message for self-interest (own listing)", async () => {
    __session = { access_token: "tok_1" };
    expressPgInterest.mockResolvedValue({ interested: false, created: false, reason: "self" });
    render(<PgInterestButton listingId="abc" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));
    await waitFor(() => expect(screen.getByText(/your own listing/i)).toBeTruthy());
  });

  it("calls onBefore on click and onSuccess after a successful interest", async () => {
    const onBefore = vi.fn();
    const onSuccess = vi.fn();
    __session = { access_token: "tok_1" };
    expressPgInterest.mockResolvedValue({ interested: true, created: true, lead_id: "x" });
    render(
      <PgInterestButton listingId="L1" locale="en" onBefore={onBefore} onSuccess={onSuccess} />
    );
    const btn = await screen.findByRole("button", { name: /interested/i });
    fireEvent.click(btn);
    expect(onBefore).toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
