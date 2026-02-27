export default function ListingDetailLoading() {
  return (
    <section className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <div
        className="skeleton-block"
        style={{ height: "2rem", width: "60%", marginBottom: "1rem" }}
      />
      <div className="card">
        <div className="card__body">
          <div
            className="skeleton-block"
            style={{ height: "1rem", width: "40%", marginBottom: "0.75rem" }}
          />
          <div
            className="skeleton-block"
            style={{ height: "1.5rem", width: "30%", marginBottom: "1rem" }}
          />
          <div
            className="skeleton-block"
            style={{ height: "4rem", width: "100%", marginBottom: "1rem" }}
          />
          <div className="skeleton-block" style={{ height: "1rem", width: "50%" }} />
        </div>
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="card__body">
          <div className="skeleton-block" style={{ height: "3rem", width: "100%" }} />
        </div>
      </div>
    </section>
  );
}
