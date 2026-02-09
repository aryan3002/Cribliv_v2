export default function CityPage({ params }: { params: { locale: string; citySlug: string } }) {
  const city = params.citySlug.replace(/-/g, " ");
  return (
    <section className="hero">
      <h1>{city}</h1>
      <p>Verified rentals in {city}, updated daily.</p>
      <div className="panel">
        <strong>SEO Landing Blueprint</strong>
        <p>Locality clusters, budget chips, and FAQs are rendered server-side.</p>
      </div>
    </section>
  );
}
