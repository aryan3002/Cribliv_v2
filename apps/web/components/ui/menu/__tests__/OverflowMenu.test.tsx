import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverflowMenu } from "../OverflowMenu";

describe("OverflowMenu", () => {
  it("opens, supports keyboard navigation and returns focus to its trigger", () => {
    const onArchive = vi.fn();
    render(
      <OverflowMenu
        ariaLabel="Listing actions"
        items={[
          { label: "Edit", onSelect: vi.fn() },
          { label: "Archive", onSelect: onArchive },
          { label: "Duplicate", onSelect: vi.fn() }
        ]}
      />
    );

    const trigger = screen.getByRole("button", { name: "Listing actions" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on escape and outside click", () => {
    render(
      <OverflowMenu ariaLabel="More actions" items={[{ label: "Archive", onSelect: vi.fn() }]} />
    );

    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders its menu in a portal and traps Tab focus within enabled items", () => {
    const { container } = render(
      <OverflowMenu
        ariaLabel="Portal actions"
        items={[
          { label: "Edit", onSelect: vi.fn() },
          { label: "Archive", onSelect: vi.fn() },
          { label: "Disabled", onSelect: vi.fn(), disabled: true }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Portal actions" }));
    const menu = screen.getByRole("menu");
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    const archive = screen.getByRole("menuitem", { name: "Archive" });

    expect(container).not.toContainElement(menu);
    expect(edit).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Tab" });
    expect(archive).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Tab", shiftKey: true });
    expect(archive).toHaveFocus();
  });
});
