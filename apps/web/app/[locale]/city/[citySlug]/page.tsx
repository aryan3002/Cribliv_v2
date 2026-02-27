import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITIES = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

export function generateStaticParams() {
  return CITIES.flatMap((city) => [
    { locale: "en", citySlug: city },
    { locale: "hi", citySlug: city }
  ]);
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; citySlug: string };
}): Promise<Metadata> {
  const city = params.citySlug.replace(/-/g, " ");
  const cityCapitalized = city.replace(/\b\w/g, (c) => c.toUpperCase());
  const isHindi = params.locale === "hi";

  const title = isHindi
    ? `${cityCapitalized} में किराये के मकान और PG — Cribliv`
    : `Verified Rentals in ${cityCapitalized} — Flats, PGs & Houses | Cribliv`;
  const description = isHindi
    ? `${cityCapitalized} में सत्यापित किराये के मकान, PG और फ्लैट खोजें। AI-संचालित खोज, मालिक सत्यापन और 12-घंटे रिफंड गारंटी।`
    : `Find verified flats, PGs, and houses for rent in ${cityCapitalized}. AI-powered search with owner verification and 12-hour refund guarantee.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/city/${params.citySlug}`,
      languages: {
        en: `${BASE_URL}/en/city/${params.citySlug}`,
        hi: `${BASE_URL}/hi/city/${params.citySlug}`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/city/${params.citySlug}`,
      siteName: "Cribliv",
      locale: isHindi ? "hi_IN" : "en_IN",
      type: "website"
    },
    twitter: { card: "summary", title, description }
  };
}

export default function CityPage({ params }: { params: { locale: string; citySlug: string } }) {
  const city = params.citySlug.replace(/-/g, " ");
  return (
    <section className="container" style={{ paddingBlock: "var(--space-6)" }}>
      <h1 className="h2">{city}</h1>
      <p>Verified rentals in {city}, updated daily.</p>
      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <div className="card__body">
          <strong>SEO Landing Blueprint</strong>
          <p>Locality clusters, budget chips, and FAQs are rendered server-side.</p>
        </div>
      </div>
    </section>
  );
}
