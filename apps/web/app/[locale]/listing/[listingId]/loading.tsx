export default function ListingDetailLoading() {
  return (
    <div className="container ld-page">
      {/* Breadcrumb */}
      <div
        className="skeleton-block"
        style={{ height: 14, width: 220, marginBottom: 16, borderRadius: 8 }}
      />

      {/* Title toolbar */}
      <div
        className="skeleton-block"
        style={{ height: 36, width: "60%", marginBottom: 12, borderRadius: 8 }}
      />
      <div
        className="skeleton-block"
        style={{ height: 16, width: 280, marginBottom: 24, borderRadius: 8 }}
      />

      {/* Gallery */}
      <div
        className="skeleton-block ld-skel ld-skel--gallery"
        style={{ marginBottom: 24, width: "100%" }}
      />

      {/* Highlights */}
      <div className="ld-skel-row" style={{ marginBottom: 24 }}>
        <span className="skeleton-block ld-skel--chip" />
        <span className="skeleton-block ld-skel--chip" />
        <span className="skeleton-block ld-skel--chip" />
        <span className="skeleton-block ld-skel--chip" />
        <span className="skeleton-block ld-skel--chip" />
      </div>

      {/* Two-column body */}
      <div className="detail-layout">
        <div className="detail-layout__content">
          {/* About */}
          <div style={{ paddingBlock: "var(--space-6)" }}>
            <div
              className="skeleton-block"
              style={{ height: 24, width: 200, marginBottom: 16, borderRadius: 8 }}
            />
            <div
              className="skeleton-block ld-skel--line"
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div
              className="skeleton-block ld-skel--line"
              style={{ width: "92%", marginBottom: 8 }}
            />
            <div className="skeleton-block ld-skel--line" style={{ width: "70%" }} />
          </div>

          {/* Host card */}
          <div
            className="skeleton-block"
            style={{ height: 120, marginBlock: 24, borderRadius: "var(--radius-lg)" }}
          />

          {/* Amenities */}
          <div style={{ paddingBlock: "var(--space-6)" }}>
            <div
              className="skeleton-block"
              style={{ height: 24, width: 240, marginBottom: 16, borderRadius: 8 }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "var(--space-4) var(--space-6)"
              }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton-block ld-skel--line" style={{ height: 24 }} />
              ))}
            </div>
          </div>

          {/* Things-to-know cards */}
          <div className="things-grid" style={{ marginBlock: 24 }}>
            <div
              className="skeleton-block"
              style={{ height: 180, borderRadius: "var(--radius-lg)" }}
            />
            <div
              className="skeleton-block"
              style={{ height: 180, borderRadius: "var(--radius-lg)" }}
            />
            <div
              className="skeleton-block"
              style={{ height: 180, borderRadius: "var(--radius-lg)" }}
            />
          </div>
        </div>

        {/* Right rail */}
        <aside className="detail-layout__sidebar">
          <div className="skeleton-block ld-skel--rail" style={{ width: "100%" }} />
        </aside>
      </div>
    </div>
  );
}
