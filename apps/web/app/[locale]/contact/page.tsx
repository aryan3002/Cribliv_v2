import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone, MapPin, Clock, MessageCircle, ArrowRight, HelpCircle } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "संपर्क करें" : "Contact Us";
  const description = isHindi
    ? "Cribliv सहायता टीम से संपर्क करें। किराये के सवाल, रिफंड, या मालिक सहायता के लिए।"
    : "Get in touch with the Cribliv support team. We help with rental queries, refunds, owner verification, and more.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/contact`,
      languages: { en: `${BASE_URL}/en/contact`, hi: `${BASE_URL}/hi/contact` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/contact`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

const FAQS = [
  {
    q: "How do I get a refund?",
    a: "If the owner doesn't respond within 12 hours, your unlock fee is automatically refunded. No action needed from your side."
  },
  {
    q: "Is there any brokerage or hidden fees?",
    a: "No. Cribliv charges zero brokerage. The only cost is a small unlock fee to reveal the owner's contact details — refundable if they don't respond."
  },
  {
    q: "How can I list my property?",
    a: "Visit the 'Become an Owner' page, complete a quick Aadhaar verification, and your listing goes live after review."
  },
  {
    q: "Which cities does Cribliv cover?",
    a: "We currently cover 8 major North Indian cities including Delhi, Noida, Gurgaon, Ghaziabad, Lucknow, Jaipur, Chandigarh, and Dehradun."
  }
];

const CHANNELS = [
  {
    icon: Mail,
    title: "Email",
    value: "info@cribliv.com",
    href: "mailto:info@cribliv.com",
    desc: "Best for detailed queries — we respond within 4 hours."
  },
  {
    icon: MessageCircle,
    title: "WhatsApp",
    value: "+91 80621 79562",
    href: "https://wa.me/918062179562",
    desc: "Quick questions and refund status checks."
  },
  {
    icon: Phone,
    title: "Phone",
    value: "+91 80621 79562",
    href: "tel:+918062179562",
    desc: "Mon–Sat, 9 AM – 7 PM IST. Hindi & English."
  }
];

export default function ContactPage({ params }: { params: { locale: string } }) {
  const isHindi = params.locale === "hi";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    mainEntity: {
      "@type": "Organization",
      name: "Cribliv",
      url: BASE_URL,
      contactPoint: [
        {
          "@type": "ContactPoint",
          email: "info@cribliv.com",
          contactType: "customer service",
          availableLanguage: ["English", "Hindi"],
          areaServed: "IN"
        }
      ]
    }
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Hero */}
      <section
        className="hero--landing"
        style={{ paddingTop: "var(--space-16)", paddingBottom: "var(--space-10)" }}
      >
        <div className="hero-glow" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <nav
            className="breadcrumb"
            style={{
              marginBottom: "var(--space-6)",
              fontSize: "var(--text-sm)",
              display: "flex",
              justifyContent: "center",
              gap: "var(--space-2)"
            }}
          >
            <a
              href={`/${params.locale}`}
              className="text-secondary"
              style={{ textDecoration: "none", color: "rgba(255,255,255,0.5)" }}
            >
              Home
            </a>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>{" / "}</span>
            <span style={{ color: "rgba(255,255,255,0.8)" }}>Contact</span>
          </nav>
          <p
            className="overline animate-in"
            style={{ color: "rgba(255,255,255,0.5)", marginBottom: "var(--space-3)" }}
          >
            {isHindi ? "सहायता" : "Support"}
          </p>
          <h1
            className="display animate-in animate-in-delay-1"
            style={{ maxWidth: 600, margin: "0 auto var(--space-5)" }}
          >
            {isHindi ? "हम यहाँ मदद के लिए हैं" : "We're Here to Help"}
          </h1>
          <p
            className="hero-subtitle animate-in animate-in-delay-2"
            style={{ maxWidth: 480, margin: "0 auto" }}
          >
            {isHindi
              ? "किराये के सवाल, रिफंड, या मालिक सहायता — हमसे संपर्क करें।"
              : "Whether it's a rental query, refund, or owner assistance — our team responds fast."}
          </p>
        </div>
      </section>

      {/* Contact Channels */}
      <section className="section--sm">
        <div className="grid grid-3">
          {CHANNELS.map((ch) => {
            const Icon = ch.icon;
            return (
              <a
                key={ch.title}
                href={ch.href}
                className="feature-card"
                style={{ textDecoration: "none", cursor: "pointer" }}
              >
                <Icon size={28} style={{ color: "var(--brand)", marginBottom: "var(--space-3)" }} />
                <h3 className="feature-card__title">{ch.title}</h3>
                <p
                  style={{
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "var(--space-2)"
                  }}
                >
                  {ch.value}
                </p>
                <p className="feature-card__desc">{ch.desc}</p>
              </a>
            );
          })}
        </div>
      </section>

      {/* Hours & Location */}
      <section className="section section--alt" style={{ padding: "var(--space-12) 0" }}>
        <div
          style={{
            maxWidth: "var(--container-max)",
            margin: "0 auto",
            paddingLeft: "var(--space-6)",
            paddingRight: "var(--space-6)"
          }}
        >
          <div className="grid grid-2">
            <div className="feature-card" style={{ textAlign: "left" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  marginBottom: "var(--space-4)"
                }}
              >
                <Clock size={24} style={{ color: "var(--brand)" }} />
                <h3 style={{ margin: 0 }}>{isHindi ? "सहायता समय" : "Support Hours"}</h3>
              </div>
              <div className="text-secondary" style={{ lineHeight: 2 }}>
                <p style={{ margin: 0 }}>
                  <strong>{isHindi ? "सोमवार – शनिवार:" : "Monday – Saturday:"}</strong> 9:00 AM –
                  7:00 PM IST
                </p>
                <p style={{ margin: 0 }}>
                  <strong>{isHindi ? "रविवार:" : "Sunday:"}</strong>{" "}
                  {isHindi ? "केवल ईमेल सहायता" : "Email support only"}
                </p>
                <p
                  style={{
                    margin: 0,
                    marginTop: "var(--space-3)",
                    fontSize: 14,
                    color: "var(--text-tertiary)"
                  }}
                >
                  {isHindi
                    ? "ईमेल प्रतिक्रिया: 4 घंटे से कम"
                    : "Email response time: under 4 hours on working days"}
                </p>
              </div>
            </div>
            <div className="feature-card" style={{ textAlign: "left" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  marginBottom: "var(--space-4)"
                }}
              >
                <MapPin size={24} style={{ color: "var(--brand)" }} />
                <h3 style={{ margin: 0 }}>{isHindi ? "कार्यालय" : "Headquarters"}</h3>
              </div>
              <div className="text-secondary" style={{ lineHeight: 2 }}>
                <p style={{ margin: 0 }}>Cribliv Technologies</p>
                <p style={{ margin: 0 }}>India</p>
                <p
                  style={{
                    margin: 0,
                    marginTop: "var(--space-3)",
                    fontSize: 14,
                    color: "var(--text-tertiary)"
                  }}
                >
                  {isHindi
                    ? "हम पूरे उत्तर भारत में 8 शहरों में सेवा प्रदान करते हैं।"
                    : "Serving 8 cities across North India"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
            <p
              className="overline"
              style={{ color: "var(--brand)", marginBottom: "var(--space-2)" }}
            >
              <HelpCircle
                size={16}
                style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
              />
              {isHindi ? "अक्सर पूछे जाने वाले प्रश्न" : "Frequently Asked Questions"}
            </p>
            <h2>{isHindi ? "जल्दी उत्तर" : "Quick Answers"}</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {FAQS.map((faq) => (
              <div key={faq.q} className="feature-card" style={{ textAlign: "left" }}>
                <h4 style={{ marginBottom: "var(--space-2)" }}>{faq.q}</h4>
                <p className="text-secondary" style={{ margin: 0, lineHeight: 1.6 }}>
                  {faq.a}
                </p>
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
        <h2>{isHindi ? "अभी खोज शुरू करें" : "Ready to Find Your Home?"}</h2>
        <p>
          {isHindi
            ? "सत्यापित किराये के मकान ब्राउज़ करने के लिए साइन-अप की जरूरत नहीं।"
            : "Browse verified rentals across 8 cities. No sign-up required to start searching."}
        </p>
        <Link href={`/${params.locale}/search`} className="btn btn--lg">
          {isHindi ? "खोजें" : "Search Rentals"} <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
