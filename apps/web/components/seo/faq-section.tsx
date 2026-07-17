import { jsonLdSafe } from "../../lib/jsonld";

/**
 * Renders an FAQ list and emits the matching FAQPage JSON-LD via a script
 * tag. Same data drives both, which keeps schema and visible copy in sync.
 */
export function FaqSection({
  title,
  items
}: {
  title: string;
  items: Array<{ q: string; a: string }>;
}) {
  if (items.length === 0) return null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a }
    }))
  };
  return (
    <section style={{ marginBottom: "var(--space-10)" }} aria-label={title}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }} />
      <h3 style={{ marginBottom: "var(--space-4)" }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {items.map((faq) => (
          <details key={faq.q} className="card" style={{ padding: "var(--space-4)" }}>
            <summary style={{ fontWeight: 600, cursor: "pointer" }}>{faq.q}</summary>
            <p className="body-sm text-secondary" style={{ margin: "var(--space-2) 0 0" }}>
              {faq.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
