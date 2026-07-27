import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NameCaptureForm } from "../name-capture-form";

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

function setup(overrides: Partial<React.ComponentProps<typeof NameCaptureForm>> = {}) {
  const onSaved = vi.fn();
  const onSkip = vi.fn();
  render(
    <NameCaptureForm
      locale="en"
      variant="tenant"
      token="acc_test"
      onSaved={onSaved}
      onSkip={onSkip}
      {...overrides}
    />
  );
  return { onSaved, onSkip };
}

describe("NameCaptureForm", () => {
  beforeEach(() => {
    // Braced: Vitest treats a returned value as a teardown callback, and
    // mockReset returns the mock — an unbraced arrow silently breaks teardown.
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
  });

  it("saves a valid name and reports it upward", async () => {
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveFullName).toHaveBeenCalledWith("acc_test", "Asha Devi");
    });
    expect(onSaved).toHaveBeenCalledWith("Asha Devi");
  });

  it("submits the normalised name, not the raw input", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "  Asha   Devi  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveFullName).toHaveBeenCalledWith("acc_test", "Asha Devi");
    });
  });

  it("rejects a too-short name without calling the API", async () => {
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(saveFullName).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("renders a localised (Devanagari) error for locale=hi, not the English zod sentence", async () => {
    // Regression test: validateFullName's `message` is an English zod
    // default; the form must map its `code` through t() instead of
    // rendering that message verbatim. Locate elements by test id (not
    // translated label/button text) and assert on script rather than
    // hardcoding the Hindi string, so the test doesn't depend on exact copy.
    setup({ locale: "hi" });
    await userEvent.type(screen.getByTestId("name-capture-input"), "A");
    await userEvent.click(screen.getByTestId("name-capture-submit"));

    const alert = await screen.findByRole("alert");
    // Devanagari block is U+0900-U+097F. Written as escapes, not literal
    // characters — U+0900 is a combining mark that renders as invisible
    // without a preceding base glyph.
    expect(alert.textContent ?? "").toMatch(/[\u0900-\u097F]/);
    expect(saveFullName).not.toHaveBeenCalled();
  });

  it("rejects angle brackets", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "<b>Asha</b>");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(saveFullName).not.toHaveBeenCalled();
  });

  it("refuses to submit an empty name", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveFullName).not.toHaveBeenCalled();
  });

  it("surfaces an API failure and does not report success", async () => {
    saveFullName.mockRejectedValue(new Error("500"));
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't save/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears a validation error once the user edits", async () => {
    setup();
    const input = screen.getByLabelText("Your name");
    await userEvent.type(input, "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.type(input, "sha");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a skip control when onSkip is provided", async () => {
    const { onSkip } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("renders no skip control when onSkip is omitted", () => {
    render(<NameCaptureForm locale="en" variant="contact" token="acc_test" onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
  });

  it("shows owner-specific copy for the owner variant", () => {
    setup({ variant: "owner" });
    expect(screen.getByText(/Seekers see your name/i)).toBeInTheDocument();
  });

  it("shows contact-specific copy for the contact variant", () => {
    setup({ variant: "contact" });
    expect(screen.getByText(/The owner will see this name/i)).toBeInTheDocument();
  });

  it("disables the submit control while in flight", async () => {
    let resolve: () => void = () => {};
    saveFullName.mockImplementation(() => {
      return new Promise<void>((r) => {
        resolve = r;
      });
    });
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolve();
  });
});
