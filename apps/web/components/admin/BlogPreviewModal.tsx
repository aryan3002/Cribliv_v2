"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  fetchAdminBlogPost,
  reviseBlogPost,
  updateBlogPost,
  type AdminBlogFullVm
} from "../../lib/admin-api";

interface Props {
  accessToken: string;
  id: string;
  onClose: () => void;
  onSaved?: () => void;
}

type ReviseTarget = "body" | "title" | "excerpt";

const DESK_LABEL: Record<string, string> = {
  "data-reports": "Data Reports",
  "local-guides": "Local Guides",
  tenancy: "Tenancy",
  "market-updates": "Market Updates"
};

function cityLabel(slug: string | null): string {
  if (!slug) return "";
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const input: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d8d2c4",
  background: "#fff",
  fontSize: 14,
  fontFamily: "inherit"
};

const label: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#6b6659",
  margin: "0 0 4px",
  textTransform: "uppercase",
  letterSpacing: "0.04em"
};

const btn: CSSProperties = {
  border: "1px solid #d8d2c4",
  background: "#fff",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer"
};

// Read + edit a draft without publishing. Two edit paths converge on the same
// fields: direct typing, and "ask AI to revise" (LLM rewrites a field on an
// instruction). Save persists via PATCH; publishing stays a separate step.
export function BlogPreviewModal({ accessToken, id, onClose, onSaved }: Props) {
  const [post, setPost] = useState<AdminBlogFullVm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [faq, setFaq] = useState<Array<{ q: string; a: string }>>([]);

  const [instruction, setInstruction] = useState("");
  const [reviseTarget, setReviseTarget] = useState<ReviseTarget>("body");
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await fetchAdminBlogPost(accessToken, id);
      setPost(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load post");
    }
  }, [accessToken, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const startEdit = () => {
    if (!post) return;
    setTitle(post.title);
    setExcerpt(post.excerpt ?? "");
    setBody(post.bodyEn);
    setFaq(post.faqItems.map((f) => ({ ...f })));
    setStatus(null);
    setEditing(true);
  };

  const askAi = useCallback(async () => {
    const ins = instruction.trim();
    if (!ins) {
      setStatus("Type an instruction first (e.g. “shorten the deposit section”).");
      return;
    }
    setRevising(true);
    setStatus(`Revising ${reviseTarget}… (~20s)`);
    try {
      const revised = await reviseBlogPost(accessToken, id, {
        instruction: ins,
        target: reviseTarget
      });
      if (reviseTarget === "body") setBody(revised);
      else if (reviseTarget === "title") setTitle(revised);
      else setExcerpt(revised);
      setInstruction("");
      setStatus("AI revision applied — review it, then Save.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Revision failed.");
    } finally {
      setRevising(false);
    }
  }, [accessToken, id, instruction, reviseTarget]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus("Saving…");
    try {
      await updateBlogPost(accessToken, id, {
        title: title.trim(),
        excerpt: excerpt.trim() || null,
        body_en: body,
        faq_items: faq.filter((f) => f.q.trim() || f.a.trim())
      });
      await load();
      setEditing(false);
      setStatus("Saved.");
      onSaved?.();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [accessToken, id, title, excerpt, body, faq, load, onSaved]);

  const busy = revising || saving;
  const failedChecks = post?.qualityChecks.filter((c) => !c.passed) ?? [];
  const needsAttention = post?.status === "needs_attention";

  return (
    <div
      onClick={() => !editing && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "40px 16px",
        zIndex: 1000,
        overflowY: "auto"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fbfaf7",
          width: "min(780px, 100%)",
          borderRadius: 12,
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          overflow: "hidden"
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 20px",
            borderBottom: "1px solid #e7e2d6",
            background: "#fff",
            position: "sticky",
            top: 0,
            zIndex: 2
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <span
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 700,
                color: "#c2301c"
              }}
            >
              {editing ? "Edit" : "Preview"}
            </span>
            {post ? (
              <span style={{ color: "#64748b" }}>
                {post.status.replace(/_/g, " ")} · quality{" "}
                {post.qualityScore != null ? post.qualityScore.toFixed(2) : "—"}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!editing && post ? (
              <button type="button" style={btn} onClick={startEdit}>
                Edit
              </button>
            ) : null}
            {editing ? (
              <>
                <button
                  type="button"
                  style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setStatus(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{
                    ...btn,
                    borderColor: "#0d9f4f",
                    background: "#0d9f4f",
                    color: "#fff",
                    opacity: busy ? 0.6 : 1
                  }}
                  disabled={busy}
                  onClick={save}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button type="button" style={btn} onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: "20px 32px 36px" }}>
          {status ? (
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: status.includes("fail") || status.includes("Failed") ? "#b91c1c" : "#0d7a3d"
              }}
            >
              {status}
            </p>
          ) : null}

          {error ? (
            <p style={{ color: "#b91c1c" }}>{error}</p>
          ) : !post ? (
            <p style={{ color: "#64748b" }}>Loading…</p>
          ) : editing ? (
            /* ── EDIT MODE ─────────────────────────────────────────── */
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* AI revise panel */}
              <div
                style={{
                  border: "1px solid #cfe3ff",
                  background: "#f2f7ff",
                  borderRadius: 10,
                  padding: "14px 16px"
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#1e40af" }}>
                  Ask AI to revise
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    style={{ ...input, width: 120 }}
                    value={reviseTarget}
                    onChange={(e) => setReviseTarget(e.target.value as ReviseTarget)}
                    disabled={busy}
                    aria-label="Field to revise"
                  >
                    <option value="body">Body</option>
                    <option value="title">Title</option>
                    <option value="excerpt">Excerpt</option>
                  </select>
                  <input
                    style={{ ...input, flex: 1, minWidth: 200 }}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) askAi();
                    }}
                    placeholder="e.g. shorten the deposit section · make the intro punchier · add a metro-connectivity paragraph"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    style={{
                      ...btn,
                      borderColor: "#1e40af",
                      background: "#1e40af",
                      color: "#fff",
                      opacity: busy ? 0.6 : 1,
                      cursor: revising ? "wait" : "pointer"
                    }}
                    disabled={busy}
                    onClick={askAi}
                  >
                    {revising ? "Revising…" : "Ask AI"}
                  </button>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#4b6bb5" }}>
                  The AI rewrites the selected field; you review the result and Save. It won’t
                  invent numbers not already in the post.
                </p>
              </div>

              <div>
                <label style={label}>Title</label>
                <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div>
                <label style={label}>Excerpt</label>
                <textarea
                  style={{ ...input, minHeight: 60, resize: "vertical" }}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                />
              </div>

              <div>
                <label style={label}>Body (HTML)</label>
                <textarea
                  style={{
                    ...input,
                    minHeight: 320,
                    resize: "vertical",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    lineHeight: 1.5
                  }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck={false}
                />
              </div>

              <div>
                <label style={label}>Q &amp; A</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {faq.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e7e2d6",
                        borderRadius: 8,
                        padding: 10,
                        background: "#fff"
                      }}
                    >
                      <input
                        style={{ ...input, marginBottom: 6, fontWeight: 600 }}
                        value={f.q}
                        placeholder="Question"
                        onChange={(e) =>
                          setFaq((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, q: e.target.value } : x))
                          )
                        }
                      />
                      <textarea
                        style={{ ...input, minHeight: 48, resize: "vertical" }}
                        value={f.a}
                        placeholder="Answer"
                        onChange={(e) =>
                          setFaq((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, a: e.target.value } : x))
                          )
                        }
                      />
                      <button
                        type="button"
                        style={{ ...btn, marginTop: 6, borderColor: "#e0b4b4", color: "#b91c1c" }}
                        onClick={() => setFaq((prev) => prev.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    style={{ ...btn, alignSelf: "flex-start" }}
                    onClick={() => setFaq((prev) => [...prev, { q: "", a: "" }])}
                  >
                    + Add Q&amp;A
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── READ MODE ─────────────────────────────────────────── */
            <>
              {needsAttention && failedChecks.length > 0 ? (
                <div
                  style={{
                    border: "1px solid #f0d38a",
                    background: "#fdf6e3",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 24
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#92400e" }}>
                    Flagged “needs attention” — {failedChecks.length} check
                    {failedChecks.length === 1 ? "" : "s"} to fix (Edit to fix, or Approve anyway)
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#7c5b13" }}>
                    {failedChecks.map((c) => (
                      <li key={c.id} style={{ marginBottom: 3 }}>
                        <strong>{c.label}:</strong> {c.detail}
                        {c.value != null && c.threshold != null
                          ? ` (${c.value} vs target ${c.threshold})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <article className="blog-preview-article">
                <p className="kicker">{DESK_LABEL[post.categorySlug ?? ""] ?? "Cribliv Times"}</p>
                <h1>{post.title}</h1>
                <p className="byline">
                  {post.citySlug ? `${cityLabel(post.citySlug)} — ` : ""}By {post.author}
                </p>
                {post.excerpt ? <p className="dek">{post.excerpt}</p> : null}
                <div dangerouslySetInnerHTML={{ __html: post.bodyEn }} />

                {post.sources.length > 0 ? (
                  <p className="source">
                    Source: {post.sources.map((s) => s.label).join(" · ")}
                    {post.dataAsof ? ` · data as of ${post.dataAsof}` : ""}
                  </p>
                ) : null}

                {post.faqItems.length > 0 ? (
                  <>
                    <h2>Questions &amp; Answers</h2>
                    {post.faqItems.map((f, i) => (
                      <div key={i} className="faq">
                        <strong>{f.q}</strong>
                        <p>{f.a}</p>
                      </div>
                    ))}
                  </>
                ) : null}
              </article>
            </>
          )}
        </div>
      </div>

      <style>{`
        .blog-preview-article { color: #1c1b17; font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; }
        .blog-preview-article .kicker { text-transform: uppercase; letter-spacing: 0.1em; font-size: 12px; font-weight: 700; color: #c2301c; margin: 0 0 8px; font-family: system-ui, sans-serif; }
        .blog-preview-article h1 { font-size: 30px; line-height: 1.15; margin: 0 0 12px; font-weight: 800; }
        .blog-preview-article .byline { font-size: 13px; color: #6b6659; font-family: system-ui, sans-serif; margin: 0 0 4px; }
        .blog-preview-article .dek { font-size: 17px; color: #45413a; font-style: italic; margin: 8px 0 18px; }
        .blog-preview-article h2 { font-size: 21px; margin: 28px 0 10px; font-weight: 700; }
        .blog-preview-article h3 { font-size: 17px; margin: 20px 0 8px; font-weight: 700; }
        .blog-preview-article p { margin: 0 0 14px; font-size: 16px; }
        .blog-preview-article ul, .blog-preview-article ol { margin: 0 0 14px; padding-left: 22px; font-size: 16px; }
        .blog-preview-article li { margin-bottom: 6px; }
        .blog-preview-article blockquote { border-left: 3px solid #c2301c; margin: 18px 0; padding: 4px 0 4px 16px; font-style: italic; color: #45413a; }
        .blog-preview-article .source { font-size: 13px; color: #6b6659; font-family: system-ui, sans-serif; border-top: 1px solid #e7e2d6; padding-top: 10px; margin-top: 20px; }
        .blog-preview-article .faq { margin-bottom: 12px; }
        .blog-preview-article .faq strong { display: block; }
        .blog-preview-article .faq p { margin: 4px 0 0; }
      `}</style>
    </div>
  );
}
