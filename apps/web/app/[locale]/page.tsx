import type { Metadata } from "next";
import { SearchHero } from "../../components/search-hero";
import { SessionBanner } from "../../components/session-banner";
import { t, type Locale } from "../../lib/i18n";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: Locale };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi
    ? "Cribliv — तेज, भरोसेमंद घर खोज"
    : "Cribliv — Fast, Trustworthy Home Search in North India";
  const description = isHindi
    ? "AI-संचालित सत्यापित किराये की खोज। दिल्ली, गुरुग्राम, नोएडा और अन्य शहरों में।"
    : "AI-powered verified rental search. Find flats, PGs, and houses in Delhi, Gurugram, Noida, and more.";

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en`,
      languages: { en: `${BASE_URL}/en`, hi: `${BASE_URL}/hi` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}`,
      siteName: "Cribliv",
      locale: params.locale === "hi" ? "hi_IN" : "en_IN",
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    }
  };
}

export default function HomePage({ params }: { params: { locale: Locale } }) {
  return (
    <div className="hero">
      <SessionBanner locale={params.locale} />
      <h1>{params.locale === "hi" ? "तेज, भरोसेमंद घर खोज" : "Fast, trustworthy home search"}</h1>
      <p>
        {params.locale === "hi"
          ? "AI पीछे काम करता है, अनुभव सरल रहता है।"
          : "AI works in the background, experience stays simple."}
      </p>
      <SearchHero locale={params.locale} />
      <div className="trust-strip">{t(params.locale, "trustStrip")}</div>
      <section className="panel">
        <h2>Top cities</h2>
        <div className="grid">
          {[
            "Delhi",
            "Gurugram",
            "Noida",
            "Ghaziabad",
            "Faridabad",
            "Chandigarh",
            "Jaipur",
            "Lucknow"
          ].map((city) => (
            <a key={city} href={`/${params.locale}/city/${city.toLowerCase()}`} className="panel">
              {city}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
