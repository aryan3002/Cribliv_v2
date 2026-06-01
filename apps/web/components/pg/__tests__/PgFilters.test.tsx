import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PgFilters } from "../PgFilters";

beforeEach(() => push.mockClear());

describe("PgFilters", () => {
  it("pushes the gender filter into the /pg URL", () => {
    render(<PgFilters locale="en" filters={{ city: "lucknow" }} />);
    fireEvent.click(screen.getByRole("button", { name: /girls/i }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/pg?"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("gender_policy=girls"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("city=lucknow"));
  });

  it("toggles an active filter off when clicked again", () => {
    render(<PgFilters locale="en" filters={{ gender_policy: "girls" }} />);
    fireEvent.click(screen.getByRole("button", { name: /girls/i }));
    const url = push.mock.calls[0][0] as string;
    expect(url).not.toContain("gender_policy");
  });
});
