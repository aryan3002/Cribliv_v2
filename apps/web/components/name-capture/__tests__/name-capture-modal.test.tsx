import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NameCaptureModal } from "../name-capture-modal";

// The modal renders the real NameCaptureForm (Task 7), which calls this on
// submit. None of these tests submit the form, but mocking it keeps the
// suite from ever making a real network call if that changes later — same
// guard as name-capture-form.test.tsx.
const saveFullName = vi.fn();
vi.mock("../../../lib/name-capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/name-capture")>(
    "../../../lib/name-capture"
  );
  return {
    ...actual,
    saveFullName: (...args: unknown[]) => {
      return saveFullName(...args);
    }
  };
});

function setup(overrides: Partial<React.ComponentProps<typeof NameCaptureModal>> = {}) {
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <NameCaptureModal
      locale="en"
      variant="tenant"
      token="acc_test"
      required={false}
      onSaved={onSaved}
      onDismiss={onDismiss}
      {...overrides}
    />
  );
  return { onSaved, onDismiss, ...view };
}

beforeEach(() => {
  // Braced: Vitest treats a returned value as a teardown callback, and
  // mockReset returns the mock — an unbraced arrow silently breaks teardown.
  saveFullName.mockReset();
  saveFullName.mockResolvedValue(undefined);
  document.body.style.overflow = "";
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("NameCaptureModal", () => {
  describe("required mode", () => {
    it("renders no skip control", () => {
      setup({ required: true });
      expect(screen.queryByTestId("name-capture-skip")).not.toBeInTheDocument();
    });

    it("renders no close control", () => {
      setup({ required: true });
      expect(screen.queryByTestId("name-capture-close")).not.toBeInTheDocument();
    });

    it("does not call onDismiss when Escape is pressed", () => {
      const { onDismiss } = setup({ required: true });
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("does not call onDismiss when the overlay is clicked", () => {
      const { onDismiss } = setup({ required: true });
      fireEvent.click(screen.getByTestId("name-capture-modal"));
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("uses the required title copy", () => {
      setup({ required: true });
      expect(
        screen.getByRole("heading", { name: "Add your name to continue" })
      ).toBeInTheDocument();
    });
  });

  describe("skippable mode", () => {
    it("renders a close control", () => {
      setup({ required: false });
      expect(screen.getByTestId("name-capture-close")).toBeInTheDocument();
    });

    it("calls onDismiss when Escape is pressed", () => {
      const { onDismiss } = setup({ required: false });
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("calls onDismiss when the overlay backdrop is clicked", () => {
      const { onDismiss } = setup({ required: false });
      fireEvent.click(screen.getByTestId("name-capture-modal"));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not call onDismiss when clicking inside the dialog", () => {
      const { onDismiss } = setup({ required: false });
      fireEvent.click(screen.getByRole("heading", { name: "What should we call you?" }));
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("uses the default title copy", () => {
      setup({ required: false });
      expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeInTheDocument();
    });
  });

  describe("body scroll lock", () => {
    it("locks body scroll while mounted", () => {
      setup();
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("restores the previous overflow value on unmount", () => {
      document.body.style.overflow = "clip";
      const { unmount } = setup();
      expect(document.body.style.overflow).toBe("hidden");

      unmount();
      expect(document.body.style.overflow).toBe("clip");
    });
  });

  describe("accessibility", () => {
    it("marks the container as a modal dialog", () => {
      setup();
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("data-testid", "name-capture-modal");
    });

    it("focuses the heading on mount", () => {
      setup();
      expect(screen.getByRole("heading")).toHaveFocus();
    });
  });

  describe("Escape propagation", () => {
    it("stops other document-level Escape listeners from running when required", () => {
      const { onDismiss } = setup({ required: true });

      // Registered AFTER the component mounts, so it sits later than the
      // modal's own listener in document's keydown queue — only then does
      // stopImmediatePropagation() have anything to actually prove. If this
      // spy were registered before setup(), it would already have run by the
      // time the modal's handler calls stopImmediatePropagation() and the
      // test would pass even without that call.
      const spy = vi.fn();
      document.addEventListener("keydown", spy);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(spy).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();

      document.removeEventListener("keydown", spy);
    });

    it("still calls onDismiss on Escape when not required", () => {
      const { onDismiss } = setup({ required: false });
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("focus trap", () => {
    it("pulls focus back into the dialog when it escapes to the page background", () => {
      setup();
      const modal = screen.getByTestId("name-capture-modal");

      const outsideButton = document.createElement("button");
      outsideButton.textContent = "Outside";
      document.body.appendChild(outsideButton);

      outsideButton.focus();

      expect(outsideButton).not.toHaveFocus();
      expect(modal.contains(document.activeElement)).toBe(true);

      outsideButton.remove();
    });

    it("does not steal focus from a different dialog stacked on top of it", () => {
      setup();

      // Stands in for WelcomeCreditsModal, which can be mounted at the same
      // time as this modal, sits above it (z-index 120 vs. this modal's
      // 110), and runs its own independent Tab-cycling focus trap. This
      // modal's trap must not fight that one for focus.
      const otherDialog = document.createElement("div");
      otherDialog.setAttribute("role", "dialog");
      const otherButton = document.createElement("button");
      otherButton.textContent = "Other dialog control";
      otherDialog.appendChild(otherButton);
      document.body.appendChild(otherDialog);

      otherButton.focus();

      expect(otherButton).toHaveFocus();

      otherDialog.remove();
    });
  });

  describe("focus restoration", () => {
    it("restores focus to the previously focused element on unmount", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open modal";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(trigger).toHaveFocus();

      const { unmount } = setup();
      expect(trigger).not.toHaveFocus();
      expect(screen.getByRole("heading")).toHaveFocus();

      unmount();
      expect(trigger).toHaveFocus();

      trigger.remove();
    });
  });
});
