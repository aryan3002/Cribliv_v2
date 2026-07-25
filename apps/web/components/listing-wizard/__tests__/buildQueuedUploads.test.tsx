import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { buildQueuedUploads, type UploadFile } from "../types";

/**
 * Regression guard for the "every photo stuck on Preparing photo…" bug.
 *
 * The wizard used to collect newly selected photos by pushing them into an
 * array *from inside* the `setUploads` updater, then iterate that array
 * synchronously to kick off HEIC conversion / compression. React only runs
 * updater functions eagerly at dispatch time as an optimisation, and it skips
 * that optimisation whenever an update is already pending on the same fiber
 * (a toast auto-dismiss timer, a Maya agent-state change, `setListingId` after
 * an autosave…). When it was skipped the array was still empty when the loop
 * ran, no photo was ever prepared, and every tile sat on "Preparing photo…"
 * with "Upload all" permanently disabled.
 *
 * So the queue must be built *before* the state update, never as a side effect
 * inside it.
 */

beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  }
});

const photo = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg", lastModified: 1 });

const fileList = (files: File[]) => {
  const list: Record<string | number | symbol, unknown> = { ...files };
  list.length = files.length;
  list.item = (i: number) => files[i] ?? null;
  list[Symbol.iterator] = function* () {
    yield* files;
  };
  return list as unknown as FileList;
};

describe("buildQueuedUploads", () => {
  it("queues every selected photo as 'preparing'", () => {
    const queued = buildQueuedUploads(fileList([photo("a.jpg"), photo("b.jpg")]), []);
    expect(queued).toHaveLength(2);
    expect(queued.every((u) => u.status === "preparing")).toBe(true);
    expect(queued.every((u) => u.retryable)).toBe(true);
  });

  it("gives each queued photo a distinct client upload id", () => {
    const queued = buildQueuedUploads(fileList([photo("a.jpg"), photo("b.jpg")]), []);
    expect(new Set(queued.map((u) => u.clientUploadId)).size).toBe(2);
  });

  it("marks a photo already in the grid as a duplicate instead of preparing it", () => {
    const existing = buildQueuedUploads(fileList([photo("a.jpg")]), []);
    const queued = buildQueuedUploads(fileList([photo("a.jpg")]), existing);
    expect(queued[0]?.status).toBe("error");
    expect(queued[0]?.retryable).toBe(false);
    expect(queued[0]?.errorMessage).toMatch(/already selected/i);
  });

  it("marks a photo selected twice in the same batch as a duplicate", () => {
    const queued = buildQueuedUploads(fileList([photo("a.jpg"), photo("a.jpg")]), []);
    expect(queued[0]?.status).toBe("preparing");
    expect(queued[1]?.status).toBe("error");
  });
});

/**
 * Mirrors how the wizard page wires selection -> queue -> preparation, so the
 * "collect inside the updater" pattern cannot creep back in.
 */
function PhotoQueueHarness({ onPrepare }: { onPrepare: (upload: UploadFile) => void }) {
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    const additions = buildQueuedUploads(files, uploads);
    if (additions.length === 0) return;
    setUploads((current) => [...current, ...additions]);
    for (const upload of additions) {
      if (upload.status === "preparing") onPrepare(upload);
    }
  }

  return (
    <div>
      {/* Any pending update on this fiber disables React's eager-updater path. */}
      <button onClick={() => setToast("saved")}>toast</button>
      <span data-testid="toast">{toast ?? ""}</span>
      <input
        data-testid="picker"
        type="file"
        multiple
        onChange={(e) => onFilesSelected(e.target.files)}
      />
      <span data-testid="preparing">{uploads.filter((u) => u.status === "preparing").length}</span>
      <span data-testid="total">{uploads.length}</span>
    </div>
  );
}

describe("wizard photo selection", () => {
  it("starts preparing every selected photo even when an update is already pending", async () => {
    const onPrepare = vi.fn();
    render(<PhotoQueueHarness onPrepare={onPrepare} />);

    // Put a pending update on the fiber in the same tick as the selection —
    // this is what made the old implementation drop the whole queue.
    fireEvent.click(screen.getByText("toast"));
    fireEvent.change(screen.getByTestId("picker"), {
      target: { files: fileList([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]) }
    });

    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("3"));
    expect(onPrepare).toHaveBeenCalledTimes(3);
  });

  it("prepares each photo exactly once", async () => {
    const onPrepare = vi.fn();
    render(<PhotoQueueHarness onPrepare={onPrepare} />);

    fireEvent.change(screen.getByTestId("picker"), {
      target: { files: fileList([photo("a.jpg"), photo("b.jpg")]) }
    });

    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("2"));
    expect(onPrepare).toHaveBeenCalledTimes(2);
    const preparedIds = onPrepare.mock.calls.map(([u]) => (u as UploadFile).clientUploadId);
    expect(new Set(preparedIds).size).toBe(2);
  });
});
