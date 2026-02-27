export default function SearchLoading() {
  return (
    <section className="hero">
      <div
        className="skeleton-block"
        style={{ height: "2rem", width: "50%", marginBottom: "1rem" }}
      />
      <div
        className="skeleton-block"
        style={{ height: "1rem", width: "30%", marginBottom: "2rem" }}
      />
      <div className="listing-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel skeleton-card">
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
