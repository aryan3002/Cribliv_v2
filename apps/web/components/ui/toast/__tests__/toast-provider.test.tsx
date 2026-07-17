import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Skeleton } from "../../skeleton/Skeleton";
import { ToastProvider } from "../toast-provider";
import { useToast } from "../use-toast";

function ToastHarness({ onRetry = vi.fn() }: { onRetry?: () => void }) {
  const toast = useToast();

  return (
    <>
      <button type="button" onClick={() => toast.success("Listing is now live")}>
        Success
      </button>
      <button
        type="button"
        onClick={() =>
          toast.error("Could not update listing", {
            action: { label: "Retry", onClick: onRetry }
          })
        }
      >
        Error
      </button>
      <button
        type="button"
        onClick={() => ["One", "Two", "Three", "Four"].forEach((message) => toast.info(message))}
      >
        Queue
      </button>
    </>
  );
}

function PromiseToastHarness({ onStart }: { onStart: (resolve: (value: string) => void) => void }) {
  const toast = useToast();

  return (
    <button
      type="button"
      onClick={() => {
        const pending = new Promise<string>((resolve) => onStart(resolve));
        void toast.promise(pending, {
          loading: "Saving listing",
          success: "Listing saved",
          error: "Could not save listing"
        });
      }}
    >
      Save
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues newest notifications in a polite live region and caps visible toasts at three", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(screen.getByRole("region", { name: "Notifications" })).toHaveAttribute(
      "aria-live",
      "polite"
    );
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
    expect(screen.getByText("Four")).toBeInTheDocument();
  });

  it("drops overflowed queued toasts instead of resurrecting them later", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    expect(screen.queryByText("One")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2800);
    });

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.queryByText("Two")).not.toBeInTheDocument();
  });

  it("auto-dismisses a success toast after the default duration", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Success" }));
    expect(screen.getByText("Listing is now live")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2800));

    expect(screen.queryByText("Listing is now live")).not.toBeInTheDocument();
  });

  it("keeps an error with an action until dismissed and invokes its action", () => {
    const onRetry = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onRetry={onRetry} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Error" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not update listing");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Could not update listing")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Dismiss notification" })).not.toBeInTheDocument();
  });

  it("keeps a promise loading notification visible until the promise settles", async () => {
    let resolve: ((value: string) => void) | undefined;
    render(
      <ToastProvider>
        <PromiseToastHarness onStart={(complete) => (resolve = complete)} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Saving listing")).toBeInTheDocument();

    await act(async () => resolve?.("saved"));
    expect(screen.queryByText("Saving listing")).not.toBeInTheDocument();
    expect(screen.getByText("Listing saved")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology unless given a label", () => {
    const { rerender } = render(<Skeleton data-testid="skeleton" />);
    expect(screen.getByTestId("skeleton")).toHaveAttribute("aria-hidden", "true");

    rerender(<Skeleton label="Loading beds" />);
    expect(screen.getByRole("status", { name: "Loading beds" })).toBeInTheDocument();
  });
});
