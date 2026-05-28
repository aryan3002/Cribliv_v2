import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PhotoGrid, type PhotoGridItem } from "../PhotoGrid";

function makeItems(count: number, overrides: Partial<PhotoGridItem> = {}): PhotoGridItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `photo-${i + 1}`,
    previewUrl: `https://example.test/photo-${i + 1}.jpg`,
    caption: `Photo ${i + 1}`,
    status: "complete" as const,
    progress: 100,
    ...overrides
  }));
}

describe("PhotoGrid", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<PhotoGrid items={[]} onReorder={() => {}} onRemove={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one tile per item, preserving order", () => {
    const items = makeItems(3);
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} />);

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(3);
    expect(images[0].getAttribute("src")).toBe(items[0].previewUrl);
    expect(images[2].getAttribute("src")).toBe(items[2].previewUrl);
  });

  it("marks only the first tile as the cover photo", () => {
    const items = makeItems(3);
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} />);

    // The visible "Cover" badge appears once, on the first tile.
    const coverBadges = screen.getAllByText(/^cover$/i);
    expect(coverBadges).toHaveLength(1);

    // The aria-label on the first tile calls out cover status; the others do
    // not — they describe themselves as moveable into the cover slot.
    const coverTile = screen.getByRole("button", { name: /cover photo:/i });
    expect(coverTile).toBeTruthy();
    const nonCoverTiles = screen.getAllByRole("button", {
      name: /^photo \d+ of grid/i
    });
    expect(nonCoverTiles).toHaveLength(2);
  });

  it("renders the cover caption on the first complete tile", () => {
    const items = makeItems(2);
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/cover photo/i)).toBeTruthy();
    expect(screen.getByText(/uploaded/i)).toBeTruthy();
  });

  it("shows the upload progress bar only while a tile is uploading", () => {
    const items: PhotoGridItem[] = [
      { id: "a", previewUrl: "x", status: "uploading", progress: 42, caption: "A" },
      { id: "b", previewUrl: "y", status: "complete", progress: 100, caption: "B" }
    ];
    const { container } = render(
      <PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} />
    );

    const progressBars = container.querySelectorAll(".cz-photo-tile__progress");
    expect(progressBars).toHaveLength(1);
  });

  it("renders the error message in the caption when a tile failed to upload", () => {
    const items: PhotoGridItem[] = [
      {
        id: "a",
        previewUrl: "x",
        status: "error",
        progress: 0,
        caption: "A",
        errorMessage: "Network timeout"
      },
      { id: "b", previewUrl: "y", status: "complete", progress: 100, caption: "B" }
    ];
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} />);

    expect(screen.getByText(/network timeout/i)).toBeTruthy();
  });

  it("calls onRemove with the tile's id when the × button is clicked", () => {
    const items = makeItems(3);
    const onRemove = vi.fn();
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={onRemove} />);

    const tiles = screen.getAllByRole("button", { name: /^photo \d+ of grid|cover photo:/i });
    // The remove × button lives inside the same tile container.
    const firstTile = tiles[0];
    const removeBtn = within(firstTile).getByRole("button", { name: /remove photo 1/i });
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(items[0].id);
  });

  it("disables remove buttons when the grid is disabled", () => {
    const items = makeItems(2);
    render(<PhotoGrid items={items} onReorder={() => {}} onRemove={() => {}} disabled />);

    const removeButtons = screen.getAllByRole("button", { name: /remove photo/i });
    for (const btn of removeButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("omits the × button when onRemove is not provided", () => {
    const items = makeItems(2);
    render(<PhotoGrid items={items} onReorder={() => {}} />);

    expect(screen.queryByRole("button", { name: /remove photo/i })).toBeNull();
  });
});
