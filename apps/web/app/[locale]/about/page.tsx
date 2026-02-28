import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  Users,
  Zap,
  Globe,
  Target,
  TrendingUp,
  ArrowRight,
  Building2,
  MapPin,
  Award,
  Heart
} from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi
    ? "Cribliv के बारे में — भारत का भरोसेमंद रेंटल प्लेटफॉर्म"
    : "About Cribliv — India's Most Trusted Rental Platform";
  const description = isHindi
    ? "Cribliv AI-संचालित सत्यापित किराये का प्लेटफॉर्म है। हमारे मिशन, टीम और विजन के बारे में जानें।"
    : "Cribliv is an AI-powered verified rental platform. Learn about our mission to eliminate broker fraud and make renting trustworthy in India.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/about`,
      languages: { en: `${BASE_URL}/en/about`, hi: `${BASE_URL}/hi/about` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/about`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

const STATS = [
  { value: "8+", label: "Cities Covered", icon: MapPin },
  { value: "100%", label: "Owner Verified", icon: ShieldCheck },
  { value: "12hr", label: "Refund Guarantee", icon: Zap },
  { value: "0%", label: "Brokerage", icon: Award }
];

const VALUES = [
  {
    icon: ShieldCheck,
    title: "Trust First",
    desc: "Every owner is identity-verified. Every listing is real. We built the verification infrastructure that the Indian rental market desperately needed.",
    color: "trust" as const
  },
  {
    icon: Zap,
    title: "AI-Native",
    desc: "Natural language search, voice input, and intelligent matching. Our AI understands context — not just keywords — to find your perfect home.",
    color: "brand" as const
  },
  {
    icon: Users,
    title: "Tenant-First",
    desc: "No brokerage, transparent pricing, 12-hour refund guarantee. We built Cribliv because we were tired of being tenants in a broken system.",
    color: "accent" as const
  },
  {
    icon: Globe,
    title: "Accessible",
    desc: "Full Hindi support, voice search for non-typists, mobile-first design. Renting should be easy for everyone, not just the tech-savvy.",
    color: "amber" as const
  }
];

export default function AboutPage({ params }: { params: { locale: string } }) {
  const isHindi = params.locale === "hi";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cribliv",
    url: BASE_URL,
    logo: `${BASE_URL}/cribliv.png`,
    description:
      "AI-powered verified rental search platform for North India. Find flats, PGs, and houses with owner verification and 12-hour refund guarantee.",
    foundingDate: "2025",
    areaServed: {
      "@type": "Country",
      name: "India"
    },
    sameAs: [],
    contactPoint: {
      "@type": "ContactPoint",
      email: "help@cribliv.com",
      contactType: "customer service",
      availableLanguage: ["English", "Hindi"]
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section
        className="hero--landing"
        style={{ paddingTop: "var(--space-16)", paddingBottom: "var(--space-12)" }}
      >
        <div className="hero-glow" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <p
            className="overline animate-in"
            style={{ color: "rgba(255,255,255,0.5)", marginBottom: "var(--space-3)" }}
          >
            {isHindi ? "हमारे बारे में" : "About Us"}
          </p>
          <h1
            className="display animate-in animate-in-delay-1"
            style={{ maxWidth: 680, margin: "0 auto var(--space-5)" }}
          >
            {isHindi ? "भारत में किराये को भरोसेमंद बनाना" : "Making Renting Trustworthy in India"}
          </h1>
          <p
            className="hero-subtitle animate-in animate-in-delay-2"
            style={{ maxWidth: 540, margin: "0 auto" }}
          >
            {isHindi
              ? "Cribliv AI-संचालित सत्यापित किराये का प्लेटफॉर्म है जो ब्रोकर धोखाधड़ी और नकली लिस्टिंग को समाप्त करता है।"
              : "Cribliv is an AI-powered rental platform that eliminates broker fraud, fake listings, and the trust deficit in Indian real estate."}
          </p>
        </div>
      </section>

      {/* Stats Strip */}
      <section className="section--sm">
        <div className="grid grid-4">
          {STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="feature-card" style={{ padding: "var(--space-6)" }}>
                <Icon size={24} style={{ color: "var(--brand)", marginBottom: "var(--space-3)" }} />
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 32,
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    lineHeight: 1
                  }}
                >
                  {stat.value}
                </div>
                <div className="body-sm text-secondary" style={{ marginTop: "var(--space-2)" }}>
                  {stat.label}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Mission */}
      <section className="section">
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <p className="overline" style={{ color: "var(--brand)", marginBottom: "var(--space-3)" }}>
            {isHindi ? "हमारा मिशन" : "Our Mission"}
          </p>
          <h2 style={{ marginBottom: "var(--space-6)" }}>
            {isHindi
              ? "हर किरायेदार को सुरक्षित और पारदर्शी अनुभव देना"
              : "Every tenant deserves a safe, transparent, and hassle-free rental experience"}
          </h2>
          <p className="text-secondary" style={{ fontSize: 17, lineHeight: 1.7 }}>
            {isHindi
              ? "भारत में 11 करोड़ से अधिक परिवार किराये पर रहते हैं, फिर भी अधिकांश को ब्रोकर धोखाधड़ी, नकली लिस्टिंग और छिपे शुल्कों का सामना करना पड़ता है। Cribliv इसे बदलने के लिए बनाया गया है — AI-सत्यापन, शून्य ब्रोकरेज और 12-घंटे रिफंड गारंटी के साथ।"
              : "Over 110 million Indian households rent their homes, yet most face broker fraud, fake listings, and hidden charges. Cribliv was built to change that — with AI-powered verification, zero brokerage, and a 12-hour refund guarantee that puts tenants first."}
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="section section--alt" style={{ padding: "var(--space-16) 0" }}>
        <div
          style={{
            maxWidth: "var(--container-max)",
            margin: "0 auto",
            paddingLeft: "var(--space-6)",
            paddingRight: "var(--space-6)"
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
            <p
              className="overline"
              style={{ color: "var(--brand)", marginBottom: "var(--space-2)" }}
            >
              {isHindi ? "हमारे मूल्य" : "Our Values"}
            </p>
            <h2>{isHindi ? "जो हमें अलग बनाता है" : "What Sets Us Apart"}</h2>
          </div>
          <div className="grid grid-2">
            {VALUES.map((v) => {
              const Icon = v.icon;
              return (
                <div key={v.title} className="feature-card" style={{ textAlign: "left" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-4)",
                      marginBottom: "var(--space-4)"
                    }}
                  >
                    <div className={`icon-circle icon-circle--${v.color}`}>
                      <Icon size={24} />
                    </div>
                    <h3 className="feature-card__title" style={{ margin: 0 }}>
                      {v.title}
                    </h3>
                  </div>
                  <p className="feature-card__desc" style={{ textAlign: "left" }}>
                    {v.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How We Verify */}
      <section className="section">
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
            <p
              className="overline"
              style={{ color: "var(--brand)", marginBottom: "var(--space-2)" }}
            >
              {isHindi ? "सत्यापन प्रक्रिया" : "Our Verification Process"}
            </p>
            <h2>{isHindi ? "हम कैसे सत्यापित करते हैं" : "How We Verify Every Owner"}</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            {[
              {
                step: 1,
                title: isHindi ? "Aadhaar सत्यापन" : "Aadhaar Verification",
                desc: isHindi
                  ? "मालिक की पहचान Aadhaar OTP के माध्यम से सत्यापित की जाती है।"
                  : "Owner identity is verified through Aadhaar OTP — ensuring the person is who they claim to be."
              },
              {
                step: 2,
                title: isHindi ? "संपत्ति दस्तावेज" : "Property Documents",
                desc: isHindi
                  ? "स्वामित्व प्रमाण, बिजली बिल या पंजीकरण दस्तावेज AI द्वारा मिलान किए जाते हैं।"
                  : "Ownership proof, electricity bills, or registration documents are AI-matched against the property address."
              },
              {
                step: 3,
                title: isHindi ? "AI गुणवत्ता स्कोर" : "AI Quality Score",
                desc: isHindi
                  ? "हमारा AI लिस्टिंग की पूर्णता, फोटो गुणवत्ता और प्रतिक्रिया दर का मूल्यांकन करता है।"
                  : "Our AI evaluates listing completeness, photo quality, and owner responsiveness to assign a trust score."
              },
              {
                step: 4,
                title: isHindi ? "12-घंटे गारंटी" : "12-Hour Guarantee",
                desc: isHindi
                  ? "अगर मालिक 12 घंटे में जवाब नहीं देता, तो आपका पैसा स्वतः वापस हो जाता है।"
                  : "If an owner doesn't respond within 12 hours, your unlock fee is automatically refunded — no questions asked."
              }
            ].map((item) => (
              <div
                key={item.step}
                style={{ display: "flex", gap: "var(--space-5)", alignItems: "flex-start" }}
              >
                <span className="step-number step-number--brand" style={{ marginTop: 2 }}>
                  {item.step}
                </span>
                <div>
                  <h4 style={{ marginBottom: "var(--space-1)" }}>{item.title}</h4>
                  <p className="text-secondary" style={{ margin: 0, lineHeight: 1.6 }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="cta-banner"
        style={{ marginLeft: "var(--space-6)", marginRight: "var(--space-6)" }}
      >
        <h2>{isHindi ? "आज ही अपना घर खोजें" : "Start Your Home Search Today"}</h2>
        <p>
          {isHindi
            ? "हजारों सत्यापित किराये के मकान आपका इंतजार कर रहे हैं।"
            : "Thousands of verified rentals across 8 cities are waiting for you. No sign-up required to browse."}
        </p>
        <Link href={`/${params.locale}/search`} className="btn btn--lg">
          {isHindi ? "खोजना शुरू करें" : "Browse Verified Rentals"} <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
