"use client";

import { useEffect, useState } from "react";
import { fetchAdminBlogPost, type AdminBlogFullVm } from "../../lib/admin-api";

interface Props {
  accessToken: string;
  id: string;
  onClose: () => void;
}

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

// Reads a draft (any status) so an editor can review the actual article — and,
// for needs_attention posts, see exactly which quality checks failed — before
// deciding to publish. Content never leaves the admin; publishing stays the
// only path to a public post.
export function BlogPreviewModal({ accessToken, id, onClose }: Props) {
  const [post, setPost] = useState<AdminBlogFullVm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBlogPost(accessToken, id)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load post");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const failedChecks = post?.qualityChecks.filter((c) => !c.passed) ?? [];
  const needsAttention = post?.status === "needs_attention";

  return (
    <div
      onClick={onClose}
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
          width: "min(760px, 100%)",
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
            top: 0
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
              Preview
            </span>
            {post ? (
              <span style={{ color: "#64748b" }}>
                {post.status.replace(/_/g, " ")} · quality{" "}
                {post.qualityScore != null ? post.qualityScore.toFixed(2) : "—"}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #e7e2d6",
              background: "#fff",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 13,
              cursor: "pointer"
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "24px 32px 36px" }}>
          {error ? (
            <p style={{ color: "#b91c1c" }}>{error}</p>
          ) : !post ? (
            <p style={{ color: "#64748b" }}>Loading preview…</p>
          ) : (
            <>
              {/* Quality report — only when the gate flagged it */}
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
                    {failedChecks.length === 1 ? "" : "s"} to fix before publishing
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

              {/* Article */}
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
