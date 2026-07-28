import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NamePromptProvider, useNamePrompt } from "../name-prompt-provider";

const useSession = vi.fn();
vi.mock("next-auth/react", () => {
  return {
    useSession: () => {
      return useSession();
    }
  };
});

const usePathname = vi.fn();
vi.mock("next/navigation", () => {
  return {
    usePathname: () => {
      return usePathname();
    }
  };
});

const fetchFullName = vi.fn();
const saveFullName = vi.fn();
vi.mock("../../../lib/name-capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/name-capture")>(
    "../../../lib/name-capture"
  );
  return {
    ...actual,
    fetchFullName: (...args: unknown[]) => {
      return fetchFullName(...args);
    },
    saveFullName: (...args: unknown[]) => {
      return saveFullName(...args);
    }
  };
});

function authed(overrides: Record<string, unknown> = {}) {
  return {
    status: "authenticated",
    data: {
      user: { id: "u1", role: "tenant", name: undefined },
      accessToken: "acc_test",
      isNewUser: false,
      ...overrides
    }
  };
}

function Consumer() {
  const { requireName } = useNamePrompt();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await requireName({ token: "acc_test" });
        document.title = ok ? "granted" : "refused";
      }}
    >
      go
    </button>
  );
}

describe("NamePromptProvider — ambient prompt", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/en");
    useSession.mockReturnValue(authed());
    fetchFullName.mockReset();
    fetchFullName.mockResolvedValue(null);
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
    window.sessionStorage.clear();
    document.title = "";
  });

  it("opens for an authenticated nameless tenant", async () => {
    render(<NamePromptProvider locale="en" />);
    expect(await screen.findByTestId("name-capture-modal")).toBeInTheDocument();
  });

  it("stays shut when the user has a name", () => {
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "tenant", name: "Asha" } }));
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut for admin", () => {
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "admin", name: undefined } }));
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut on the login page", () => {
    usePathname.mockReturnValue("/en/auth/login");
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut while the welcome-credits modal is pending", () => {
    useSession.mockReturnValue(
      authed({ isNewUser: true, signupReward: { creditsGranted: 50, expiresAt: null } })
    );
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("is dismissable and does not reopen in the same session", async () => {
    const { unmount } = render(<NamePromptProvider locale="en" />);
    await userEvent.click(await screen.findByTestId("name-capture-skip"));
    await waitFor(() => {
      expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
    });

    unmount();
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("closes after a successful save", async () => {
    render(<NamePromptProvider locale="en" />);
    await userEvent.type(await screen.findByTestId("name-capture-input"), "Asha Devi");
    await userEvent.click(screen.getByTestId("name-capture-submit"));
    await waitFor(() => {
      expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
    });
  });
});

describe("NamePromptProvider — requireName gate", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/en/listing/abc");
    // Named, so the ambient prompt stays out of the way of these assertions.
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "tenant", name: "Asha" } }));
    fetchFullName.mockReset();
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
    window.sessionStorage.clear();
    document.title = "";
  });

  it("resolves true immediately when the API says a name exists", async () => {
    fetchFullName.mockResolvedValue("Asha Devi");
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("opens an unskippable modal when there is no name, then resolves true on save", async () => {
    fetchFullName.mockResolvedValue(null);
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));

    expect(await screen.findByTestId("name-capture-modal")).toBeInTheDocument();
    // Required mode: no skip, no close.
    expect(screen.queryByTestId("name-capture-skip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("name-capture-close")).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId("name-capture-input"), "Asha Devi");
    await userEvent.click(screen.getByTestId("name-capture-submit"));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });

  it("resolves true rather than blocking when the name lookup fails", async () => {
    // A dead /auth/me must not make the product unusable — fail open.
    fetchFullName.mockRejectedValue(new Error("offline"));
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });

  it("resolves true outside a provider so isolated components still work", async () => {
    render(<Consumer />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });
});
