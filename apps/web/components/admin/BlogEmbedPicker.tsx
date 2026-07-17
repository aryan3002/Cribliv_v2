"use client";

import { useState, type CSSProperties } from "react";
import { useSearchSuggestions, type CriblivSuggestion } from "../../lib/use-search-suggestions";

type Mode = "listing" | "pg";

const wrap: CSSProperties = {
  border: "1px solid #e7e2d6",
  borderRadius: 8,
  padding: 8,
  background: "#faf9f6",
  marginBottom: 8
};
const tab: CSSProperties = {
  border: "1px solid #d8d2c4",
  background: "#fff",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer"
};
const tabActive: CSSProperties = {
  ...tab,
  background: "#0066ff",
  color: "#fff",
  borderColor: "#0066ff"
};
const search: CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #d8d2c4",
  fontSize: 13,
  fontFamily: "inherit"
};
const list: CSSProperties = {
  listStyle: "none",
  margin: "6px 0 0",
  padding: 0,
  maxHeight: 200,
  overflowY: "auto"
};
const item: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  borderBottom: "1px solid #efeae0",
  background: "transparent",
  padding: "6px 4px",
  fontSize: 13,
  cursor: "pointer"
};

/**
 * Search + pick a live listing/PG to embed into a blog post. On selection it
 * emits an embed token (`{{listing:<id>}}` or `{{pg:<city>/<id>}}`) via onInsert;
 * the editor splices it at the caret. Reuses the shared suggest engine, and
 * only offers Cribliv listing suggestions (locality/Google results are dropped).
 */
export function BlogEmbedPicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [mode, setMode] = useState<Mode>("listing");
  const { suggestions, onQueryChange } = useSearchSuggestions(mode === "pg" ? "pg" : "homes");

  const listings: CriblivSuggestion[] = suggestions
    .filter((s) => s.source === "cribliv" && (s.data as CriblivSuggestion).type === "listing")
    .map((s) => s.data as CriblivSuggestion);

  function pick(s: CriblivSuggestion) {
    if (mode === "pg") onInsert(`{{pg:${s.city_slug ?? ""}/${s.value}}}`);
    else onInsert(`{{listing:${s.value}}}`);
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {(["listing", "pg"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            style={mode === m ? tabActive : tab}
          >
            {m === "listing" ? "Insert property" : "Insert PG"}
          </button>
        ))}
      </div>

      <input
        type="search"
        aria-label="Search listings to embed"
        placeholder={mode === "pg" ? "Search PGs by title…" : "Search properties by title…"}
        onChange={(e) => onQueryChange(e.target.value)}
        style={search}
      />

      {listings.length > 0 && (
        <ul style={list}>
          {listings.map((s) => (
            <li key={s.value}>
              <button type="button" onClick={() => pick(s)} style={item}>
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                {typeof s.rent === "number" && s.rent > 0 ? (
                  <span> · ₹{s.rent.toLocaleString("en-IN")}</span>
                ) : null}
                {s.verified ? <span style={{ color: "#0d9f4f" }}> · ✓ Verified</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
