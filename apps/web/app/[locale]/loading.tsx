export default function LocaleLoading() {
  return (
    <section className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <div
        className="skeleton-block"
        style={{ height: "2rem", width: "60%", marginBottom: "1rem" }}
      />
      <div
        className="skeleton-block"
        style={{ height: "1rem", width: "40%", marginBottom: "2rem" }}
      />
      <div
        className="skeleton-block"
        style={{ height: "3rem", width: "100%", marginBottom: "2rem" }}
      />
      <div className="grid grid--4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-card" style={{ height: "120px" }} />
        ))}
      </div>
    </section>
  );
}
