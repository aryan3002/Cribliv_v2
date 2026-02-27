export default function LocaleLoading() {
  return (
    <section className="hero">
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
      <div className="grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel skeleton-block" style={{ height: "120px" }} />
        ))}
      </div>
    </section>
  );
}
