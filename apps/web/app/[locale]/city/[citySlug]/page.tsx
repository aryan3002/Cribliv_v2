import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { fetchApi, buildSearchQuery } from "../../../../lib/api";
import { ListingCardItem } from "../../../../components/listing-card";

interface ListingCard {
  id: string;
  title: string;
  city: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  cover_photo?: string | null;
}

interface SearchResponse {
  items: ListingCard[];
  total: number;
  page: number;
  page_size: number;
}

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
    ? `${cityCapitalized} में किराये के मकान और PG`
    : `Verified Rentals in ${cityCapitalized} — Flats, PGs & Houses`;
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

/** Per-city hero metadata — map image, stat pills, CTA copy */
const CITY_META: Record<
  string,
  {
    mapImage: string;
    pills: { label: string; value: string }[];
    ctaEn: string;
    ctaHi: string;
  }
> = {
  noida: {
    mapImage: "/images/cities/noida-map.jpg",
    pills: [
      { label: "PG", value: "from ₹4,000/mo" },
      { label: "1 BHK", value: "from ₹8,000/mo" },
      { label: "2 BHK", value: "from ₹12,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Noida Rentals",
    ctaHi: "नोएडा में खोजें"
  },
  delhi: {
    mapImage: "/images/cities/delhi-map.jpg",
    pills: [
      { label: "PG", value: "from ₹5,000/mo" },
      { label: "1 BHK", value: "from ₹10,000/mo" },
      { label: "2 BHK", value: "from ₹18,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Delhi Rentals",
    ctaHi: "दिल्ली में खोजें"
  },
  gurugram: {
    mapImage: "/images/cities/gurugram-map.jpg",
    pills: [
      { label: "PG", value: "from ₹6,000/mo" },
      { label: "1 BHK", value: "from ₹12,000/mo" },
      { label: "2 BHK", value: "from ₹20,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Gurugram Rentals",
    ctaHi: "गुरुग्राम में खोजें"
  },
  ghaziabad: {
    mapImage: "/images/cities/ghaziabad-map.jpg",
    pills: [
      { label: "PG", value: "from ₹3,500/mo" },
      { label: "1 BHK", value: "from ₹7,000/mo" },
      { label: "2 BHK", value: "from ₹11,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Ghaziabad Rentals",
    ctaHi: "गाज़ियाबाद में खोजें"
  },
  faridabad: {
    mapImage: "/images/cities/faridabad-map.jpg",
    pills: [
      { label: "PG", value: "from ₹3,500/mo" },
      { label: "1 BHK", value: "from ₹7,000/mo" },
      { label: "2 BHK", value: "from ₹11,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Faridabad Rentals",
    ctaHi: "फ़रीदाबाद में खोजें"
  },
  chandigarh: {
    mapImage: "/images/cities/chandigarh-map.jpg",
    pills: [
      { label: "PG", value: "from ₹5,000/mo" },
      { label: "1 BHK", value: "from ₹9,000/mo" },
      { label: "2 BHK", value: "from ₹14,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Chandigarh Rentals",
    ctaHi: "चंडीगढ़ में खोजें"
  },
  jaipur: {
    mapImage: "/images/cities/jaipur-map.jpg",
    pills: [
      { label: "PG", value: "from ₹4,000/mo" },
      { label: "1 BHK", value: "from ₹7,500/mo" },
      { label: "2 BHK", value: "from ₹12,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Jaipur Rentals",
    ctaHi: "जयपुर में खोजें"
  },
  lucknow: {
    mapImage: "/images/cities/lucknow-map.jpg",
    pills: [
      { label: "PG", value: "from ₹3,500/mo" },
      { label: "1 BHK", value: "from ₹7,000/mo" },
      { label: "2 BHK", value: "from ₹11,000/mo" },
      { label: "Zero Brokerage", value: "Direct Owners" }
    ],
    ctaEn: "Browse Lucknow Rentals",
    ctaHi: "लखनऊ में खोजें"
  }
};

export default async function CityPage({
  params
}: {
  params: { locale: string; citySlug: string };
}) {
  const city = params.citySlug.replace(/-/g, " ");
  const cityCapitalized = city.replace(/\b\w/g, (c) => c.toUpperCase());
  const isHindi = params.locale === "hi";

  // Fetch top listings for this city
  let listings: ListingCard[] = [];
  try {
    const response = await fetchApi<SearchResponse>(
      `/listings/search?${buildSearchQuery({ city: params.citySlug, page_size: "9" })}`,
      undefined,
      { server: true }
    );
    listings = response.items;
  } catch {
    // Silent — page still renders without listings
  }

  const cityMeta = CITY_META[params.citySlug] ?? null;
  const budgetChips = ["Under ₹8,000", "₹8k–₹15k", "₹15k–₹25k", "₹25k+"];
  const typeChips = ["Flat/House", "PG", "1 BHK", "2 BHK", "Furnished"];
  const localities = CITY_LOCALITIES[params.citySlug] ?? ["Sector 1", "Sector 2", "Central"];

  const FAQS_DATA = [
    {
      q: isHindi ? "क्या मकान मालिक सत्यापित हैं?" : "Are owners verified?",
      a: isHindi
        ? "हाँ — हम Aadhaar और संपत्ति दस्तावेजों के माध्यम से प्रत्येक मालिक की पहचान सत्यापित करते हैं।"
        : "Yes — we verify each owner's identity via Aadhaar and property documents before their listing goes live."
    },
    {
      q: isHindi ? "12 घंटे की रिफंड गारंटी क्या है?" : "What's the 12-hour refund guarantee?",
      a: isHindi
        ? "यदि मालिक 12 घंटे में जवाब नहीं देता, तो आपका पैसा स्वचालित रूप से वापस कर दिया जाता है।"
        : "If the owner doesn't respond within 12 hours of you unlocking their contact, you get an automatic refund."
    },
    {
      q: isHindi ? "Cribliv ब्रोकर्स से कैसे अलग है?" : "How is Cribliv different from brokers?",
      a: isHindi
        ? "कोई ब्रोकर नहीं — सीधे सत्यापित मालिकों से बात करें। AI-संचालित खोज आपके बजट और जरूरतों से मैच करता है।"
        : "No brokers — connect directly with verified owners. AI-powered search matches your budget, location, and requirements."
    }
  ];

  // FAQPage JSON-LD for Google rich results
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS_DATA.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };

  // BreadcrumbList JSON-LD
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${params.locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: `Rentals in ${cityCapitalized}`,
        item: `${BASE_URL}/${params.locale}/city/${params.citySlug}`
      }
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* City Hero */}
      <section
        className="hero hero--landing"
        style={
          cityMeta
            ? {
                textAlign: "center",
                backgroundImage: `linear-gradient(to bottom,
                  rgba(4,12,28,0.08) 0%,
                  rgba(4,12,28,0.12) 28%,
                  rgba(4,12,28,0.60) 56%,
                  rgba(4,12,28,0.88) 76%,
                  rgba(4,12,28,1.00) 100%
                ), url('${cityMeta.mapImage}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                minHeight: 480,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                paddingTop: "var(--space-8)",
                paddingBottom: "var(--space-12)"
              }
            : {
                paddingTop: "var(--space-16)",
                paddingBottom: "var(--space-12)",
                textAlign: "center"
              }
        }
      >
        {!cityMeta && <div className="hero-glow" aria-hidden="true" />}
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <p
            className="overline animate-in"
            style={{ color: "rgba(255,255,255,0.5)", marginBottom: "var(--space-3)" }}
          >
            {isHindi ? "किराया खोजें" : "EXPLORE RENTALS"}
          </p>
          <h1 className="animate-in" style={{ animationDelay: "100ms" }}>
            {isHindi
              ? `${cityCapitalized} में सत्यापित किराये`
              : `Verified Rentals in ${cityCapitalized}`}
          </h1>
          <p
            className="hero-subtitle animate-in"
            style={{ animationDelay: "200ms", maxWidth: 560, margin: "var(--space-3) auto 0" }}
          >
            {isHindi
              ? "AI-संचालित खोज, मालिक सत्यापन और 12-घंटे रिफंड गारंटी।"
              : "AI-powered search with owner verification and 12-hour refund guarantee."}
          </p>

          {/* Rent-range stat pills — all map-hero cities */}
          {cityMeta && (
            <div
              className="animate-in"
              style={{
                display: "flex",
                gap: "var(--space-3)",
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: "var(--space-6)"
              }}
            >
              {cityMeta.pills.map(({ label, value }) => (
                <div key={label} className="hero-stat-pill">
                  <div
                    style={{
                      color: "rgba(255,255,255,0.95)",
                      fontWeight: 700,
                      fontSize: 13,
                      letterSpacing: "0.05em"
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Hero CTA — all map-hero cities */}
          {cityMeta && (
            <div
              className="animate-in"
              style={{ marginTop: "var(--space-6)", animationDelay: "300ms" }}
            >
              <Link
                href={`/${params.locale}/search?city=${params.citySlug}`}
                className="btn btn--primary btn--lg"
              >
                {isHindi ? cityMeta.ctaHi : cityMeta.ctaEn} <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </section>
      {cityMeta && (
        <div
          aria-hidden="true"
          style={{
            height: 72,
            marginTop: -72,
            background: "linear-gradient(to bottom, transparent, var(--surface-page, #f8fafc))",
            position: "relative",
            zIndex: 1,
            pointerEvents: "none"
          }}
        />
      )}

      <div
        className="container"
        style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-16)" }}
      >
        {/* Budget Chips */}
        <section style={{ marginBottom: "var(--space-10)" }}>
          <h3 style={{ marginBottom: "var(--space-4)" }}>
            {isHindi ? "बजट के अनुसार" : "Browse by Budget"}
          </h3>
          <div className="chip-row" style={{ flexWrap: "wrap" }}>
            {budgetChips.map((chip) => (
              <a
                key={chip}
                href={`/${params.locale}/search?city=${params.citySlug}&q=${encodeURIComponent(chip)}`}
                className="chip-btn"
              >
                {chip}
              </a>
            ))}
          </div>
        </section>

        {/* Type Chips */}
        <section style={{ marginBottom: "var(--space-10)" }}>
          <h3 style={{ marginBottom: "var(--space-4)" }}>
            {isHindi ? "प्रकार के अनुसार" : "Browse by Type"}
          </h3>
          <div className="chip-row" style={{ flexWrap: "wrap" }}>
            {typeChips.map((chip) => (
              <a
                key={chip}
                href={`/${params.locale}/search?city=${params.citySlug}&q=${encodeURIComponent(chip)}`}
                className="chip-btn"
              >
                {chip}
              </a>
            ))}
          </div>
        </section>

        {/* Locality Clusters */}
        <section style={{ marginBottom: "var(--space-10)" }}>
          <h3
            style={{
              marginBottom: "var(--space-4)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)"
            }}
          >
            {cityMeta && (
              <MapPin
                size={18}
                style={{ color: "var(--brand)", flexShrink: 0 }}
                aria-hidden="true"
              />
            )}
            {isHindi ? "लोकप्रिय इलाके" : `Popular Areas in ${cityCapitalized}`}
          </h3>
          <div
            className="listing-grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
          >
            {localities.map((loc) => (
              <a
                key={loc}
                href={`/${params.locale}/search?city=${params.citySlug}&q=${encodeURIComponent(loc)}`}
                className="card"
                style={{ textDecoration: "none", padding: "var(--space-5)", textAlign: "center" }}
              >
                {cityMeta && (
                  <MapPin
                    size={14}
                    style={{
                      color: "var(--brand)",
                      marginBottom: "var(--space-1)",
                      display: "block",
                      margin: "0 auto var(--space-1)"
                    }}
                    aria-hidden="true"
                  />
                )}
                <span className="body-sm text-brand" style={{ fontWeight: 600 }}>
                  {loc}
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* Featured Listings */}
        {listings.length > 0 && (
          <section style={{ marginBottom: "var(--space-10)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-4)"
              }}
            >
              <h3 style={{ margin: 0 }}>
                {isHindi ? `${cityCapitalized} में लिस्टिंग` : `Listings in ${cityCapitalized}`}
              </h3>
              <Link
                href={`/${params.locale}/search?city=${params.citySlug}`}
                className="body-sm text-brand"
                style={{
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
              </Link>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "var(--space-6)"
              }}
            >
              {listings.map((item) => (
                <ListingCardItem
                  key={item.id}
                  locale={params.locale}
                  listing={{
                    id: item.id,
                    title: item.title,
                    city: item.city,
                    city_name: cityCapitalized,
                    locality: item.locality ?? null,
                    listing_type: item.listing_type,
                    monthly_rent: item.monthly_rent,
                    bhk: item.bhk ?? null,
                    furnishing: item.furnishing ?? null,
                    area_sqft: item.area_sqft ?? null,
                    verification_status: item.verification_status,
                    cover_photo: item.cover_photo ?? null
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section>
          <h3 style={{ marginBottom: "var(--space-4)" }}>
            {isHindi ? "अक्सर पूछे जाने वाले प्रश्न" : "Frequently Asked Questions"}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {FAQS_DATA.map((faq) => (
              <div key={faq.q} className="card" style={{ padding: "var(--space-5)" }}>
                <strong style={{ display: "block", marginBottom: "var(--space-2)" }}>
                  {faq.q}
                </strong>
                <p className="body-sm text-secondary" style={{ margin: 0 }}>
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{ marginTop: "var(--space-10)", textAlign: "center" }}>
          <Link
            href={`/${params.locale}/search?city=${params.citySlug}`}
            className="btn btn--primary btn--lg"
          >
            {isHindi ? `${cityCapitalized} में खोजें` : `Search Rentals in ${cityCapitalized}`}{" "}
            <ArrowRight size={18} />
          </Link>
        </section>
      </div>
    </>
  );
}

/** Locality data for each supported city — rendered server-side for SEO */
const CITY_LOCALITIES: Record<string, string[]> = {
  delhi: [
    "Dwarka",
    "Rohini",
    "Saket",
    "Lajpat Nagar",
    "Karol Bagh",
    "Vasant Kunj",
    "Pitampura",
    "Janakpuri"
  ],
  gurugram: [
    "Sector 49",
    "Sector 56",
    "Sohna Road",
    "Golf Course Road",
    "MG Road",
    "DLF Phase 1",
    "Sector 82"
  ],
  noida: [
    "Sector 62",
    "Sector 137",
    "Sector 18",
    "Sector 50",
    "Sector 75",
    "Greater Noida West",
    "Sector 76"
  ],
  ghaziabad: ["Indirapuram", "Vaishali", "Raj Nagar Extension", "Crossings Republik", "Kaushambi"],
  faridabad: ["Sector 15", "NIT", "Sector 37", "Surajkund", "Old Faridabad"],
  chandigarh: ["Sector 17", "Sector 22", "Sector 35", "Manimajra", "Mohali"],
  jaipur: ["Malviya Nagar", "Vaishali Nagar", "Mansarovar", "Jagatpura", "C-Scheme", "Raja Park"],
  lucknow: ["Gomti Nagar", "Hazratganj", "Aliganj", "Indira Nagar", "Mahanagar"]
};
