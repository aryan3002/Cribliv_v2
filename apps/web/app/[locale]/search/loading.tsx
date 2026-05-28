export default function SearchLoading() {
  return (
    <section className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <div
        className="skeleton-block"
        style={{ height: "2rem", width: "50%", marginBottom: "1rem" }}
      />
      <div
        className="skeleton-block"
        style={{ height: "1rem", width: "30%", marginBottom: "2rem" }}
      />
      <div className="grid grid--3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton-block" style={{ height: "140px", marginBottom: "0.75rem" }} />
            <div
              className="skeleton-block"
              style={{ height: "1rem", width: "70%", marginBottom: "0.5rem" }}
            />
            <div className="skeleton-block" style={{ height: "1rem", width: "40%" }} />
          </div>
        ))}
      </div>
    </section>
  );
}
