export default function PgOnboardingPage() {
  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      <h1 className="h2">PG Onboarding</h1>
      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <div className="card__body">
          If beds &lt;= 29: self-serve. If beds &gt;= 30: sales lead path.
        </div>
      </div>
    </section>
  );
}
