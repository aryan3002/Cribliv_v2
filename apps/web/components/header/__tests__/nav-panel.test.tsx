import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavPanelView } from "../nav-panel";
import { buildRentPanel } from "../../../lib/nav/nav-model";

const panel = buildRentPanel("en", "lucknow");

describe("NavPanelView", () => {
  it("renders every column title", () => {
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={() => {}} />);
    for (const col of panel.columns) expect(screen.getByText(col.title)).toBeInTheDocument();
  });

  it("renders every link with its real href", () => {
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={() => {}} />);
    for (const col of panel.columns) {
      for (const link of col.links) {
        expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
      }
    }
  });

  it("is a labelled group for assistive tech", () => {
    render(<NavPanelView panel={panel} labelledBy="rent-trigger" onNavigate={() => {}} />);
    expect(screen.getByRole("group")).toHaveAttribute("aria-labelledby", "rent-trigger");
  });

  it("calls onNavigate when a link is clicked, so the panel can close", async () => {
    const onNavigate = vi.fn();
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={onNavigate} />);
    await userEvent.click(screen.getAllByRole("link")[0]);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("renders nothing for a panel with no columns", () => {
    const { container } = render(
      <NavPanelView panel={{ id: "rent", columns: [] }} labelledBy="t" onNavigate={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
