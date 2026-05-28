"use client";

/**
 * PhotoGrid — drag-to-reorder grid for listing photos.
 *
 * Visual model (reference: Airbnb photo manager, Notion gallery)
 * --------------------------------------------------------------
 *   1. On lift, the source tile becomes invisible (opacity: 0) but its grid
 *      slot stays reserved. The user sees ONE moving tile, never two.
 *   2. The DragOverlay renders a portal-mounted clone at the cursor — it's
 *      the sole visual of the dragged tile, riding the pointer 1:1 with no
 *      easing during drag.
 *   3. Sibling tiles slide to their new positions in a single timing curve
 *      (200ms, cubic-bezier(0.2, 0, 0, 1)). No layout collapse.
 *   4. On drop, the overlay flies to its final slot with a slight spring,
 *      then the source returns to opacity 1 in its new position.
 *
 * Why not @hello-pangea/dnd:
 * --------------------------
 *   It's a linear-list library. Inside CSS Grid it collapses the lifted
 *   tile's slot, snaps siblings, and renders the floating clone in a
 *   fixed-position layer that visually escapes the grid bounds.
 *   `@dnd-kit/sortable` + `rectSortingStrategy` is purpose-built for grids.
 *
 * Accessibility
 * -------------
 *   - KeyboardSensor: space-to-lift, arrows-to-move, space-to-drop,
 *     esc-to-cancel — out of the box.
 *   - Each tile carries an aria-label that calls out cover status + index.
 *   - Touch: 150ms hold + 5px tolerance distinguishes drag from tap-to-remove.
 *   - Pointer: 4px movement distinguishes drag from a stray click.
 *
 * Performance
 * -----------
 *   - Tile visual is wrapped in React.memo; previewUrl identity stable
 *     across reorders so <img> never re-decodes during drag.
 *   - Reorder is GPU-only transforms via dnd-kit; no layout thrash.
 *   - MeasuringStrategy.Always keeps droppable rects fresh during drag,
 *     so target detection stays accurate even as siblings animate.
 */

import { memo, useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface PhotoGridItem {
  id: string;
  previewUrl: string;
  caption?: string;
  status?: "pending" | "uploading" | "complete" | "error";
  progress?: number;
  errorMessage?: string;
}

export interface PhotoGridProps {
  items: PhotoGridItem[];
  onReorder: (next: PhotoGridItem[]) => void;
  onRemove?: (id: string) => void;
  /** Disables all interactions (drag + remove). */
  disabled?: boolean;
}

interface TileContentProps {
  item: PhotoGridItem;
  index: number;
  isCoverDropTarget: boolean;
  isOverlay?: boolean;
}

const TileContent = memo(function TileContent({
  item,
  index,
  isCoverDropTarget,
  isOverlay = false
}: TileContentProps) {
  const isCoverSlot = index === 0;

  return (
    <>
      {isCoverSlot ? (
        <span className="cz-photo-tile__badge" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
          </svg>
          Cover
        </span>
      ) : null}

      {isCoverDropTarget ? (
        <span className="cz-photo-tile__hint" aria-hidden="true">
          Drops here = cover
        </span>
      ) : null}

      <img
        src={item.previewUrl}
        alt={item.caption ?? `Listing photo ${index + 1}`}
        className="cz-photo-tile__img"
        draggable={false}
        loading={isOverlay ? "eager" : "lazy"}
        decoding="async"
      />

      {item.status === "uploading" ? (
        <div className="cz-photo-tile__progress" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, item.progress ?? 0))}%` }} />
        </div>
      ) : null}

      <figcaption className="cz-photo-tile__caption">
        {item.status === "error"
          ? item.errorMessage || "Upload failed"
          : item.status === "uploading"
            ? "Uploading…"
            : item.status === "complete"
              ? isCoverSlot
                ? "Cover photo"
                : "Uploaded"
              : (item.caption ?? `Photo ${index + 1}`)}
      </figcaption>
    </>
  );
});

/**
 * Direction this tile will move if the user drops at the current `over`
 * position. -1 = will shift one slot earlier (←), +1 = one slot later (→),
 * 0 = will not move. We compute it from the source and target indices using
 * the same array-move semantics dnd-kit applies on drop.
 *
 *   activeFrom < activeTo: tiles in (from, to] shift LEFT by one
 *   activeFrom > activeTo: tiles in [to, from) shift RIGHT by one
 */
function computeShift(tileIndex: number, activeFrom: number, activeTo: number): -1 | 0 | 1 {
  if (activeFrom === -1 || activeTo === -1) return 0;
  if (activeFrom === activeTo) return 0;
  if (tileIndex === activeFrom) return 0;
  if (activeFrom < activeTo) {
    if (tileIndex > activeFrom && tileIndex <= activeTo) return -1;
    return 0;
  }
  // activeFrom > activeTo
  if (tileIndex >= activeTo && tileIndex < activeFrom) return 1;
  return 0;
}

interface ShiftArrowProps {
  direction: -1 | 1;
}

/**
 * Visual cue overlaid on a sibling tile while a drag is in progress,
 * showing which direction it will slide when the user drops. Lives in a
 * non-clickable layer so it can never block dnd-kit's pointer events.
 */
const ShiftArrow = memo(function ShiftArrow({ direction }: ShiftArrowProps) {
  return (
    <span
      className={`cz-photo-tile__shift cz-photo-tile__shift--${direction === -1 ? "left" : "right"}`}
      aria-hidden="true"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === -1 ? (
          <polyline points="15 6 9 12 15 18" />
        ) : (
          <polyline points="9 6 15 12 9 18" />
        )}
      </svg>
    </span>
  );
});

interface SortableTileProps {
  item: PhotoGridItem;
  index: number;
  isCoverDropTarget: boolean;
  shift: -1 | 0 | 1;
  onRemove?: (id: string) => void;
  disabled: boolean;
}

function SortableTile({
  item,
  index,
  isCoverDropTarget,
  shift,
  onRemove,
  disabled
}: SortableTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
    // Don't animate the *transform* of the tile that's actively being
    // dragged — the DragOverlay is its visual. Other tiles animate normally.
    animateLayoutChanges: () => true
  });

  const isCoverSlot = index === 0;

  // The dragged source must NOT carry the live drag offset — we hide it
  // entirely and let the overlay take over. Sibling tiles still receive
  // their `transform` so they slide cleanly to make room.
  const style: React.CSSProperties = isDragging
    ? {
        // opacity 0 keeps the grid slot reserved but invisible. No
        // transition: the hand-off to the overlay should be instant.
        opacity: 0,
        transition: "none",
        // Ensure the invisible source doesn't capture pointer events
        // intended for the overlay or for siblings underneath.
        pointerEvents: "none"
      }
    : {
        transform: CSS.Transform.toString(transform),
        transition
      };

  const tileClassName = [
    "cz-photo-tile",
    isCoverSlot ? "cz-photo-tile--cover" : null,
    isCoverDropTarget ? "cz-photo-tile--cover-target" : null,
    shift !== 0 ? "cz-photo-tile--shifting" : null,
    item.status === "error" ? "cz-photo-tile--error" : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={tileClassName}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable photo tile"
      aria-label={
        isCoverSlot
          ? `Cover photo: ${item.caption ?? "photo"} (position ${index + 1}). Press space to reorder.`
          : `Photo ${index + 1} of grid: ${item.caption ?? "photo"}. Press space to reorder. Drag to position 1 to make cover.`
      }
    >
      <TileContent item={item} index={index} isCoverDropTarget={isCoverDropTarget} />

      {shift !== 0 && !isDragging ? <ShiftArrow direction={shift} /> : null}

      {onRemove ? (
        <button
          type="button"
          className="cz-photo-tile__remove"
          aria-label={`Remove photo ${index + 1}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item.id);
          }}
          // The remove button MUST NOT initiate a drag. dnd-kit listens on
          // pointerdown — stopping propagation prevents the sensor from
          // claiming the gesture.
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={disabled}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

// Drop animation: a single timing curve, mildly springy, fast enough to
// feel responsive (220ms) without snapping. The source tile fades from
// opacity 0 → 1 over the same duration so the hand-off back from overlay
// is invisible.
const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.18, 0.67, 0.32, 1.06)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: "0" }
    }
  })
};

export function PhotoGrid({ items, onReorder, onRemove, disabled = false }: PhotoGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // `overId` tracks which tile the cursor is currently hovering. Combined
  // with `activeId` it tells us where the drop would land — which is what
  // drives the per-tile shift arrows. dnd-kit fires `onDragOver` only when
  // the over target changes, so this is at most one re-render per crossed
  // tile boundary (5-10 times across a typical drag).
  const [overId, setOverId] = useState<string | null>(null);

  // Activation thresholds tuned for "instant" feel without false positives:
  //   - Pointer: 4px movement. Mouse drags now respond after a single px-flick.
  //   - Touch: 150ms hold + 5px tolerance. Sensitive enough to feel snappy
  //     while still distinguishing a tap-to-remove from a drag.
  //   - Keyboard: standard sortable coordinate getter.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const activeItem = useMemo(
    () => (activeId ? (items.find((item) => item.id === activeId) ?? null) : null),
    [activeId, items]
  );
  const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;
  // The "destination" index — what slot the dragged tile would land in if
  // the user released right now. Defaults to the source (no movement) when
  // the cursor isn't over any tile.
  const targetIndex = useMemo(() => {
    if (!overId) return activeIndex;
    const i = items.findIndex((item) => item.id === overId);
    return i === -1 ? activeIndex : i;
  }, [overId, items, activeIndex]);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
  }, []);

  const onDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setOverId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = items.findIndex((item) => item.id === active.id);
      const to = items.findIndex((item) => item.id === over.id);
      if (from === -1 || to === -1 || from === to) return;
      onReorder(arrayMove(items, from, to));
    },
    [items, onReorder]
  );

  const onDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  if (items.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // Continuously remeasure droppables so target detection stays accurate
      // as siblings animate to their new positions. Without this, large
      // moves (across multiple rows) can land in the wrong cell.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>
        <div
          className={[
            "cz-photo-grid",
            activeId ? "cz-photo-grid--active" : null,
            disabled ? "cz-photo-grid--disabled" : null
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Listing photos. Drag to reorder. The first photo is your cover."
        >
          {items.map((item, index) => (
            <SortableTile
              key={item.id}
              item={item}
              index={index}
              // Slot 0 highlights as the cover drop target only when a
              // *different* (non-cover) tile is being dragged.
              isCoverDropTarget={index === 0 && activeId !== null && activeId !== item.id}
              shift={activeId === null ? 0 : computeShift(index, activeIndex, targetIndex)}
              onRemove={onRemove}
              disabled={disabled}
            />
          ))}
        </div>
      </SortableContext>

      {/* DragOverlay = the only visible representation of the dragged tile
          while a drag is in progress. Portal-mounted, so it can't be
          clipped by the grid container or any ancestor with overflow. */}
      <DragOverlay
        adjustScale={false}
        dropAnimation={DROP_ANIMATION}
        modifiers={[restrictToWindowEdges]}
        zIndex={1000}
      >
        {activeItem ? (
          <div className="cz-photo-tile cz-photo-tile--overlay" aria-hidden="true">
            <TileContent
              item={activeItem}
              index={activeIndex >= 0 ? activeIndex : 0}
              isCoverDropTarget={false}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
