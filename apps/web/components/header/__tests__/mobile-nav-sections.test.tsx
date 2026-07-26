import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileNavSections } from "../mobile-nav-sections";
// Value-importing the desktop model is fine HERE: a test never ships to a
// browser bundle. MobileNavSections itself must only ever receive NavPanel
// objects as props — see the bundle-size note in lib/nav/nav-data.ts.
import { buildRentPanel, buildPgPanel, buildOwnersPanel } from "../../../lib/nav/nav-model";

const rent = buildRentPanel("en", "lucknow");
const pg = buildPgPanel("en", "lucknow");
const owners = buildOwnersPanel("en");

function renderSections(onNavigate: () => void = vi.fn()) {
  return render(
    <MobileNavSections locale="en" rent={rent} pg={pg} owners={owners} onNavigate={onNavigate} />
  );
}

/** The <div role="group"> a trigger's aria-controls points at, once open. */
function openPanelFor(triggerName: string): HTMLElement {
  const trigger = screen.getByRole("button", { name: triggerName });
  const panelId = trigger.getAttribute("aria-controls");
  if (!panelId) throw new Error(`${triggerName} trigger has no aria-controls`);
  const panel = document.getElementById(panelId);
  if (!panel) throw new Error(`no element with id ${panelId} in the document`);
  return panel;
}

describe("MobileNavSections", () => {
  it("renders all three section headers", () => {
    renderSections();
    expect(screen.getByRole("button", { name: "Rent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PG & Co-living" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For owners" })).toBeInTheDocument();
  });

  it("renders localized section headers for Hindi", () => {
    render(
      <MobileNavSections
        locale="hi"
        rent={buildRentPanel("hi", "lucknow")}
        pg={buildPgPanel("hi", "lucknow")}
        owners={buildOwnersPanel("hi")}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "किराया" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "पीजी और को-लिविंग" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "मकान मालिकों के लिए" })).toBeInTheDocument();
  });

  it("starts with every section collapsed", () => {
    renderSections();
    for (const name of ["Rent", "PG & Co-living", "For owners"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("clicking a header expands it and sets aria-expanded", async () => {
    const user = userEvent.setup();
    renderSections();

    await user.click(screen.getByRole("button", { name: "Rent" }));

    expect(screen.getByRole("button", { name: "Rent" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("opening a second section collapses the first", async () => {
    const user = userEvent.setup();
    renderSections();

    await user.click(screen.getByRole("button", { name: "Rent" }));
    expect(screen.getByRole("button", { name: "Rent" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "PG & Co-living" }));
    expect(screen.getByRole("button", { name: "Rent" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "PG & Co-living" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    // Only one panel region exists at a time.
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("clicking the open section's own header collapses it again", async () => {
    const user = userEvent.setup();
    renderSections();
    const trigger = screen.getByRole("button", { name: "Rent" });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it.each([
    ["Rent", () => rent],
    ["PG & Co-living", () => pg],
    ["For owners", () => owners]
  ] as const)(
    "every link in the desktop %s panel also appears in the mobile section",
    async (triggerName, getPanel) => {
      const user = userEvent.setup();
      renderSections();
      await user.click(screen.getByRole("button", { name: triggerName }));

      const region = openPanelFor(triggerName);
      const panel = getPanel();
      for (const column of panel.columns) {
        for (const link of column.links) {
          expect(within(region).getByRole("link", { name: link.label })).toHaveAttribute(
            "href",
            link.href
          );
        }
      }
    }
  );

  it("calls onNavigate when a link is clicked, closing the whole sheet", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderSections(onNavigate);

    await user.click(screen.getByRole("button", { name: "Rent" }));
    const [firstLink] = screen.getAllByRole("link");
    await user.click(firstLink);

    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("is a labelled group for assistive tech, matching the desktop NavPanelView pattern", async () => {
    const user = userEvent.setup();
    renderSections();
    const trigger = screen.getByRole("button", { name: "Rent" });
    await user.click(trigger);

    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("aria-labelledby", trigger.id);
  });
});
