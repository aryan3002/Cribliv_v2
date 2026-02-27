export default function CityLoading() {
  return (
    <section className="hero">
      <div
        className="skeleton-block"
        style={{ height: "2rem", width: "40%", marginBottom: "1rem" }}
      />
      <div
        className="skeleton-block"
        style={{ height: "1rem", width: "55%", marginBottom: "2rem" }}
      />
      <div className="panel">
        <div
          className="skeleton-block"
          style={{ height: "1rem", width: "30%", marginBottom: "1rem" }}
        />
        <div className="skeleton-block" style={{ height: "5rem", width: "100%" }} />
      </div>
    </section>
  );
}
