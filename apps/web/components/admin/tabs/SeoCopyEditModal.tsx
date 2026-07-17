"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  deleteSeoCopyOverride,
  fetchSeoCopyForPath,
  revalidateSeoPaths,
  upsertSeoCopyOverride,
  type SeoCopyFields
} from "../../../lib/admin-api";

interface Props {
  accessToken: string;
  citySlug: string;
  locality: { slug: string; name_en: string; name_hi: string };
  onClose: () => void;
  /** Called after a successful save/revert so the parent can refresh chips. */
  onSaved: () => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

type Locale = "en" | "hi";

const EMPTY: SeoCopyFields = {
  h1: "",
  meta_title: "",
  meta_description: "",
  intro_paragraph: "",
  nearby_blurb: "",
  faq_items: []
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function localizedPaths(citySlug: string, slug: string): string[] {
  return [`/en/city/${citySlug}/${slug}`, `/hi/city/${citySlug}/${slug}`];
}

const fieldStyle = { width: "100%", padding: "6px 8px", font: "inherit" } as const;

export function SeoCopyEditModal({
  accessToken,
  citySlug,
  locality,
  onClose,
  onSaved,
  onToast
}: Props) {
  const [locale, setLocale] = useState<Locale>("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState<SeoCopyFields | null>(null);
  const [form, setForm] = useState<SeoCopyFields>(EMPTY);
  const [notes, setNotes] = useState("");

  const pagePath = `/city/${citySlug}/${locality.slug}`;

  // Load the currently stored copy whenever the locale (or locality) changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSeoCopyForPath(pagePath, locale)
      .then((copy) => {
        if (cancelled) return;
        setLive(copy);
        setForm(copy ? { ...EMPTY, ...copy, nearby_blurb: copy.nearby_blurb ?? "" } : EMPTY);
      })
      .catch(() => {
        if (!cancelled) {
          setLive(null);
          setForm(EMPTY);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath, locale]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField<K extends keyof SeoCopyFields>(key: K, value: SeoCopyFields[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setFaq(index: number, key: "q" | "a", value: string) {
    setForm((prev) => {
      const faq_items = prev.faq_items.map((item, i) =>
        i === index ? { ...item, [key]: value } : item
      );
      return { ...prev, faq_items };
    });
  }

  function addFaq() {
    setForm((prev) => ({ ...prev, faq_items: [...prev.faq_items, { q: "", a: "" }] }));
  }

  function removeFaq(index: number) {
    setForm((prev) => ({ ...prev, faq_items: prev.faq_items.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const copy: SeoCopyFields = {
        h1: form.h1.trim(),
        meta_title: form.meta_title.trim(),
        meta_description: form.meta_description.trim(),
        intro_paragraph: form.intro_paragraph.trim(),
        nearby_blurb: form.nearby_blurb?.trim() ? form.nearby_blurb.trim() : null,
        faq_items: form.faq_items
          .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
          .filter((f) => f.q || f.a)
      };
      await upsertSeoCopyOverride(accessToken, {
        citySlug,
        localitySlug: locality.slug,
        locale,
        copy,
        notes: notes.trim() || null
      });
      await revalidateSeoPaths(accessToken, localizedPaths(citySlug, locality.slug));
      onToast(`Saved ${locale.toUpperCase()} override for ${locality.name_en}`, "trust");
      onSaved();
      onClose();
    } catch (err) {
      onToast(errMsg(err) || "Could not save override", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    setSaving(true);
    try {
      await deleteSeoCopyOverride(accessToken, pagePath, locale);
      await revalidateSeoPaths(accessToken, localizedPaths(citySlug, locality.slug));
      onToast(`Reverted ${locale.toUpperCase()} copy for ${locality.name_en}`, "trust");
      onSaved();
      onClose();
    } catch (err) {
      onToast(errMsg(err) || "Could not revert override", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit copy for ${locality.name_en}`}
        className="admin-drawer"
        style={{
          width: "min(560px, 94vw)",
          top: "50%",
          right: "50%",
          transform: "translate(50%, -50%)",
          borderRadius: 14,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <header className="admin-drawer__head">
          <div>
            <div className="admin-drawer__title">Edit copy · {locality.name_en}</div>
            <div className="admin-drawer__sub">{pagePath}</div>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--icon"
            onClick={onClose}
            aria-label="Close editor"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="admin-drawer__body" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {(["en", "hi"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                className={`admin-btn admin-btn--sm ${locale === l ? "admin-btn--primary" : "admin-btn--ghost"}`}
                onClick={() => setLocale(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
            {loading && <span className="admin-table__id">Loading…</span>}
          </div>

          {live && (
            <div
              style={{
                background: "var(--ad-surface-2)",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 12
              }}
            >
              <div className="admin-table__id">Currently live</div>
              <div style={{ fontWeight: 600 }}>{live.h1 || "—"}</div>
              <div style={{ color: "var(--ad-text-2)" }}>{live.intro_paragraph || "—"}</div>
            </div>
          )}

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">H1</span>
            <input
              aria-label="h1"
              value={form.h1}
              onChange={(e) => setField("h1", e.target.value)}
              style={fieldStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">Meta title</span>
            <input
              aria-label="meta_title"
              value={form.meta_title}
              onChange={(e) => setField("meta_title", e.target.value)}
              style={fieldStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">Meta description</span>
            <textarea
              aria-label="meta_description"
              value={form.meta_description}
              onChange={(e) => setField("meta_description", e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">Intro paragraph</span>
            <textarea
              aria-label="intro_paragraph"
              value={form.intro_paragraph}
              onChange={(e) => setField("intro_paragraph", e.target.value)}
              rows={4}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">Nearby blurb</span>
            <textarea
              aria-label="nearby_blurb"
              value={form.nearby_blurb ?? ""}
              onChange={(e) => setField("nearby_blurb", e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="admin-table__id">FAQ ({form.faq_items.length})</span>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={addFaq}
                disabled={form.faq_items.length >= 6}
              >
                + Add FAQ
              </button>
            </div>
            {form.faq_items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gap: 4,
                  borderTop: "1px solid var(--ad-border)",
                  paddingTop: 6
                }}
              >
                <input
                  aria-label={`faq-question-${i + 1}`}
                  placeholder="Question"
                  value={item.q}
                  onChange={(e) => setFaq(i, "q", e.target.value)}
                  style={fieldStyle}
                />
                <textarea
                  aria-label={`faq-answer-${i + 1}`}
                  placeholder="Answer"
                  value={item.a}
                  onChange={(e) => setFaq(i, "a", e.target.value)}
                  rows={2}
                  style={{ ...fieldStyle, resize: "vertical" }}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => removeFaq(i)}
                  style={{ justifySelf: "start" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="admin-table__id">Notes (audited)</span>
            <input
              aria-label="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={fieldStyle}
            />
          </label>
        </div>

        <footer className="admin-drawer__footer" style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="admin-btn admin-btn--danger admin-btn--sm"
            onClick={() => void handleRevert()}
            disabled={saving}
            title="Delete the override and revert to AI copy (or template)"
          >
            Revert to AI
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--sm"
            onClick={() => void handleSave()}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save override"}
          </button>
        </footer>
      </div>
    </>
  );
}
