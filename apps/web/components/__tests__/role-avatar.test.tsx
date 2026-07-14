import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoleAvatar, type RoleAvatarRole } from "../role-avatar";

describe("RoleAvatar", () => {
  it.each<RoleAvatarRole>(["tenant", "owner", "pg_operator", "admin"])(
    "renders the %s portrait in compact and menu sizes",
    (role) => {
      const { rerender } = render(<RoleAvatar role={role} size="compact" />);

      expect(screen.getByTestId("role-avatar")).toHaveAttribute("data-role-avatar", role);
      expect(screen.getByTestId("role-avatar")).toHaveClass("role-avatar--compact");

      rerender(<RoleAvatar role={role} size="menu" />);

      expect(screen.getByTestId("role-avatar")).toHaveAttribute("data-role-avatar", role);
      expect(screen.getByTestId("role-avatar")).toHaveClass("role-avatar--menu");
    }
  );

  it("renders a generic fallback when the role is missing", () => {
    render(<RoleAvatar size="compact" />);

    expect(screen.getByTestId("role-avatar")).toHaveAttribute("data-role-avatar", "fallback");
  });
});
