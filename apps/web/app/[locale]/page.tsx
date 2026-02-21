import { SearchHero } from "../../components/search-hero";
import { SessionBanner } from "../../components/session-banner";
import { t, type Locale } from "../../lib/i18n";

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
