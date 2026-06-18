"use client";

import { useEffect, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { ImageOff, Star, Trash2, Upload, GripVertical } from "lucide-react";
import type { PgAdminListingFull, PgAdminListingPhoto } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { ConfirmDialog } from "../../primitives/ConfirmDialog";
import {
  presignAdminPgPhotos,
  commitAdminPgPhotos,
  reorderAdminPgPhotos,
  deleteAdminPgPhoto,
  putToAzureBlob
} from "../../../../lib/admin-api";

interface Props {
  full: PgAdminListingFull;
  accessToken: string;
  listingId: string;
  onToast?: (msg: string, kind?: "success" | "error") => void;
  refetchFull: () => Promise<void>;
}

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function PhotosSection({ full, accessToken, listingId, onToast, refetchFull }: Props) {
  const [items, setItems] = useState<PgAdminListingPhoto[]>(full.photos);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Keep local order in sync after a refetch.
  useEffect(() => setItems(full.photos), [full.photos]);

  const persistOrder = async (next: PgAdminListingPhoto[]) => {
    const hasCover = next.some((p) => p.is_cover);
    const payload = next.map((p, idx) => ({
      id: p.id,
      sort_order: idx,
      is_cover: hasCover ? p.is_cover : idx === 0
    }));
    try {
      await reorderAdminPgPhotos(accessToken, listingId, payload);
      await refetchFull();
    } catch (e) {
      onToast?.((e as Error).message || "Reorder failed", "error");
      await refetchFull();
    }
  };

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.index === r.source.index) return;
    const next = reorder(items, r.source.index, r.destination.index);
    setItems(next); // optimistic
    void persistOrder(next);
  };

  const setCover = (id: string) => {
    const next = items.map((p) => ({ ...p, is_cover: p.id === id }));
    setItems(next);
    void persistOrder(next);
  };

  const onUpload = async (files: FileList) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    setBusy(true);
    try {
      const presignInput = arr.map((f) => ({
        clientUploadId: uuid(),
        contentType: f.type || "image/jpeg",
        sizeBytes: f.size
      }));
      const { uploads } = await presignAdminPgPhotos(accessToken, listingId, presignInput);
      // uploads preserve request order → uploads[i] ↔ arr[i].
      await Promise.all(uploads.map((u, i) => putToAzureBlob(u.uploadUrl, arr[i])));
      const base = items.length;
      const photos = uploads.map((u, i) => ({
        clientUploadId: u.clientUploadId,
        blobPath: u.blobPath,
        isCover: items.length === 0 && i === 0,
        sortOrder: base + i
      }));
      await commitAdminPgPhotos(accessToken, listingId, photos);
      await refetchFull();
      onToast?.(`${arr.length} photo${arr.length === 1 ? "" : "s"} uploaded`, "success");
    } catch (e) {
      const err = e as Error & { code?: string };
      onToast?.(err.code ? `Upload failed: ${err.code}` : err.message || "Upload failed", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteAdminPgPhoto(accessToken, listingId, id);
      await refetchFull();
      onToast?.("Photo deleted", "success");
    } catch (e) {
      onToast?.((e as Error).message || "Delete failed", "error");
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  };

  return (
    <SectionCard
      title="Photos"
      subtitle={
        items.length
          ? `${items.length} photo${items.length === 1 ? "" : "s"} · drag to reorder, star to set cover.`
          : "No photos yet."
      }
      action={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => e.target.files && onUpload(e.target.files)}
          />
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> {busy ? "Working…" : "Upload"}
          </button>
        </>
      }
    >
      {items.length === 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--ad-text-3)",
            fontSize: 13,
            padding: "20px 0"
          }}
        >
          <ImageOff size={16} /> No photos. Upload to get started.
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="pg-photos" direction="horizontal">
            {(dp) => (
              <div
                ref={dp.innerRef}
                {...dp.droppableProps}
                style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}
              >
                {items.map((p, i) => (
                  <Draggable key={p.id} draggableId={p.id} index={i}>
                    {(dr, snap) => (
                      <div
                        ref={dr.innerRef}
                        {...dr.draggableProps}
                        style={{
                          position: "relative",
                          width: 168,
                          flexShrink: 0,
                          borderRadius: 10,
                          overflow: "hidden",
                          border: p.is_cover
                            ? "2px solid var(--ad-brand)"
                            : "1px solid var(--ad-border)",
                          background: "var(--ad-surface-2)",
                          boxShadow: snap.isDragging ? "0 8px 24px rgba(0,0,0,.18)" : "none",
                          ...dr.draggableProps.style
                        }}
                      >
                        <div style={{ position: "relative", aspectRatio: "4 / 3" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.blob_path}
                            alt=""
                            loading="lazy"
                            onClick={() => setLightbox(p.blob_path)}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              cursor: "zoom-in"
                            }}
                          />
                          <span
                            {...dr.dragHandleProps}
                            title="Drag to reorder"
                            style={{
                              position: "absolute",
                              top: 6,
                              left: 6,
                              background: "rgba(0,0,0,.6)",
                              color: "#fff",
                              borderRadius: 6,
                              padding: 3,
                              cursor: "grab",
                              display: "inline-flex"
                            }}
                          >
                            <GripVertical size={13} />
                          </span>
                          {p.is_cover && (
                            <span
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 6,
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#fff",
                                background: "var(--ad-brand)",
                                borderRadius: 6,
                                padding: "2px 7px"
                              }}
                            >
                              COVER
                            </span>
                          )}
                          {p.moderation_status !== "approved" && (
                            <span
                              style={{
                                position: "absolute",
                                bottom: 6,
                                left: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                color: "var(--ad-warning)",
                                background: "var(--ad-warning-soft)",
                                border: "1px solid #FDE68A",
                                borderRadius: 6,
                                padding: "1px 6px"
                              }}
                            >
                              {p.moderation_status}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, padding: 8 }}>
                          <button
                            type="button"
                            className="admin-chip admin-btn--sm"
                            disabled={busy || p.is_cover}
                            onClick={() => setCover(p.id)}
                            title="Set as cover"
                            style={{ flex: 1, justifyContent: "center" }}
                          >
                            <Star size={12} /> Cover
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            disabled={busy}
                            onClick={() => setConfirmDel(p.id)}
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {dp.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            cursor: "zoom-out",
            padding: 32
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: "92vw", maxHeight: "88vh", borderRadius: 10, objectFit: "contain" }}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDel != null}
        title="Delete this photo?"
        body={
          <div style={{ fontSize: 13, color: "var(--ad-text-2)" }}>
            It will be removed from the listing on every surface. This can’t be undone.
          </div>
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && doDelete(confirmDel)}
      />
    </SectionCard>
  );
}
