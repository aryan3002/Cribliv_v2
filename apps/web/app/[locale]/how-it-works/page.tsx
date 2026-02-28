import type { Metadata } from "next";
import Link from "next/link";
import {
  Search,
  ShieldCheck,
  Phone,
  ArrowRight,
  CheckCircle2,
  Zap,
  Clock,
  CreditCard,
  Star,
  Sparkles
} from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi
    ? "कैसे काम करता है — Cribliv सत्यापित किराया"
    : "How It Works — Cribliv Verified Rentals";
  const description = isHindi
    ? "3 आसान चरणों में Cribliv पर सत्यापित किराये का मकान खोजें। AI खोज, मालिक सत्यापन, और 12-घंटे गारंटी।"
    : "Find a verified rental on Cribliv in 3 simple steps. AI-powered search, owner verification, and a 12-hour refund guarantee.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/how-it-works`,
      languages: {
        en: `${BASE_URL}/en/how-it-works`,
        hi: `${BASE_URL}/hi/how-it-works`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/how-it-works`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

const STEPS = [
  {
    icon: Search,
    title: "Search Naturally",
    titleHi: "प्राकृतिक खोज",
    desc: 'Type or speak exactly what you want — "2BHK near metro under ₹15k" — and our AI understands context, not just keywords. Filter by city, budget, type, locality, and more.',
    descHi:
      'जो आप चाहते हैं वो टाइप या बोलें — "मेट्रो के पास 2BHK ₹15k के अंदर" — और हमारा AI संदर्भ समझता है, सिर्फ शब्द नहीं।',
    features: [
      "Natural language + voice search",
      "Smart filters: city, budget, type, locality",
      "Hindi & English supported"
    ],
    featuresHi: [
      "प्राकृतिक भाषा + आवाज खोज",
      "स्मार्ट फिल्टर: शहर, बजट, प्रकार",
      "हिंदी और अंग्रेजी समर्थित"
    ]
  },
  {
    icon: ShieldCheck,
    title: "Verified Owners Only",
    titleHi: "केवल सत्यापित मालिक",
    desc: "Every owner goes through Aadhaar verification and property document checks before their listing goes live. No fake listings, no ghost owners, no bait-and-switch.",
    descHi:
      "प्रत्येक मालिक Aadhaar सत्यापन और संपत्ति दस्तावेज जांच से गुजरता है। कोई नकली लिस्टिंग नहीं, कोई धोखा नहीं।",
    features: [
      "Aadhaar OTP verification",
      "Property document matching",
      "AI-powered quality scoring"
    ],
    featuresHi: ["Aadhaar OTP सत्यापन", "संपत्ति दस्तावेज मिलान", "AI गुणवत्ता स्कोरिंग"]
  },
  {
    icon: Phone,
    title: "Unlock & Connect",
    titleHi: "अनलॉक करें और जुड़ें",
    desc: "Found a place you love? Pay a small unlock fee to reveal the owner's direct contact. If they don't respond within 12 hours, you get an automatic full refund.",
    descHi:
      "पसंदीदा जगह मिली? मालिक का सीधा संपर्क पाने के लिए एक छोटी अनलॉक फीस दें। 12 घंटे में जवाब न आने पर पूरा रिफंड।",
    features: [
      "Direct owner contact — zero brokers",
      "12-hour refund guarantee",
      "Secure UPI/card payments"
    ],
    featuresHi: [
      "सीधा मालिक संपर्क — शून्य ब्रोकर",
      "12-घंटे रिफंड गारंटी",
      "सुरक्षित UPI/कार्ड भुगतान"
    ]
  }
];

const GUARANTEES = [
  {
    icon: ShieldCheck,
    title: "100% Verified",
    desc: "Every owner is Aadhaar-verified"
  },
  {
    icon: Clock,
    title: "12hr Refund",
    desc: "Auto-refund if no response"
  },
  {
    icon: CreditCard,
    title: "Zero Brokerage",
    desc: "No hidden charges, ever"
  },
  {
    icon: Sparkles,
    title: "AI-Powered",
    desc: "Smart search that understands you"
  }
];

export default function HowItWorksPage({ params }: { params: { locale: string } }) {
  const isHindi = params.locale === "hi";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: isHindi
      ? "Cribliv पर सत्यापित किराये का मकान कैसे खोजें"
      : "How to Find a Verified Rental on Cribliv",
    description: isHindi
      ? "3 आसान चरणों में Cribliv पर अपना अगला किराये का मकान खोजें।"
      : "Find your next rental home on Cribliv in 3 simple steps.",
    step: STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: isHindi ? s.titleHi : s.title,
      text: isHindi ? s.descHi : s.desc
    }))
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
        style={{ paddingTop: "var(--space-16)", paddingBottom: "var(--space-10)" }}
      >
        <div className="hero-glow" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <p
            className="overline animate-in"
            style={{
              color: "rgba(255,255,255,0.5)",
              marginBottom: "var(--space-3)"
            }}
          >
            {isHindi ? "कैसे काम करता है" : "How It Works"}
          </p>
          <h1
            className="display animate-in animate-in-delay-1"
            style={{ maxWidth: 680, margin: "0 auto var(--space-5)" }}
          >
            {isHindi ? "3 आसान चरणों में अपना घर खोजें" : "Find Your Home in 3 Simple Steps"}
          </h1>
          <p
            className="hero-subtitle animate-in animate-in-delay-2"
            style={{ maxWidth: 520, margin: "0 auto" }}
          >
            {isHindi
              ? "कोई ब्रोकर नहीं। कोई नकली लिस्टिंग नहीं। बस सत्यापित मालिक और AI-संचालित खोज।"
              : "No brokers. No fake listings. Just verified owners and AI-powered search that actually works."}
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="section" style={{ paddingTop: "var(--space-14)" }}>
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)"
          }}
        >
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const features = isHindi ? step.featuresHi : step.features;
            return (
              <div
                key={step.title}
                style={{
                  display: "flex",
                  gap: "var(--space-8)",
                  alignItems: "flex-start",
                  flexWrap: "wrap"
                }}
              >
                {/* Step indicator */}
                <div style={{ flex: "0 0 auto", textAlign: "center" }}>
                  <span
                    className="step-number step-number--brand"
                    style={{
                      width: 56,
                      height: 56,
                      fontSize: 22,
                      marginBottom: "var(--space-3)"
                    }}
                  >
                    {i + 1}
                  </span>
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      marginBottom: "var(--space-3)"
                    }}
                  >
                    <Icon size={24} style={{ color: "var(--brand)" }} />
                    <h2 style={{ margin: 0, fontSize: 22 }}>
                      {isHindi ? step.titleHi : step.title}
                    </h2>
                  </div>
                  <p
                    className="text-secondary"
                    style={{
                      lineHeight: 1.7,
                      marginBottom: "var(--space-4)",
                      fontSize: 16
                    }}
                  >
                    {isHindi ? step.descHi : step.desc}
                  </p>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)"
                    }}
                  >
                    {features.map((f) => (
                      <li
                        key={f}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          color: "var(--text-secondary)",
                          fontSize: 14
                        }}
                      >
                        <CheckCircle2 size={16} style={{ color: "var(--brand)", flexShrink: 0 }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust Guarantees */}
      <section className="section section--alt" style={{ padding: "var(--space-14) 0" }}>
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
              {isHindi ? "हमारी गारंटी" : "Our Guarantees"}
            </p>
            <h2>{isHindi ? "आपका भरोसा, हमारी प्राथमिकता" : "Your Trust, Our Priority"}</h2>
          </div>
          <div className="grid grid-4">
            {GUARANTEES.map((g) => {
              const Icon = g.icon;
              return (
                <div key={g.title} className="feature-card" style={{ padding: "var(--space-6)" }}>
                  <Icon
                    size={28}
                    style={{
                      color: "var(--brand)",
                      marginBottom: "var(--space-3)"
                    }}
                  />
                  <h3 className="feature-card__title" style={{ marginBottom: "var(--space-2)" }}>
                    {g.title}
                  </h3>
                  <p className="feature-card__desc">{g.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Owner CTA */}
      <section className="section">
        <div
          style={{
            maxWidth: 700,
            margin: "0 auto",
            textAlign: "center"
          }}
        >
          <Star size={32} style={{ color: "var(--amber)", marginBottom: "var(--space-4)" }} />
          <h2 style={{ marginBottom: "var(--space-4)" }}>
            {isHindi ? "क्या आप मालिक हैं?" : "Are You a Property Owner?"}
          </h2>
          <p
            className="text-secondary"
            style={{
              marginBottom: "var(--space-6)",
              lineHeight: 1.7,
              fontSize: 16
            }}
          >
            {isHindi
              ? "Cribliv पर अपनी संपत्ति लिस्ट करें और हज़ारों सत्यापित किरायेदारों से जुड़ें। कोई कमीशन नहीं, बस त्वरित Aadhaar सत्यापन।"
              : "List your property on Cribliv and reach thousands of verified tenants actively looking for a home. Quick Aadhaar verification, no commission, and full control over your listing."}
          </p>
          <Link href={`/${params.locale}/become-owner`} className="btn btn--lg">
            {isHindi ? "मालिक बनें" : "List Your Property"} <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Search CTA */}
      <section
        className="cta-banner"
        style={{
          marginLeft: "var(--space-6)",
          marginRight: "var(--space-6)"
        }}
      >
        <h2>{isHindi ? "अभी खोजना शुरू करें" : "Start Searching Now"}</h2>
        <p>
          {isHindi
            ? "हजारों सत्यापित किराये के मकान आपका इंतजार कर रहे हैं।"
            : "Thousands of verified listings in 8 cities. No sign-up needed to browse."}
        </p>
        <Link href={`/${params.locale}/search`} className="btn btn--lg">
          {isHindi ? "सत्यापित किराये खोजें" : "Find Verified Rentals"} <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
