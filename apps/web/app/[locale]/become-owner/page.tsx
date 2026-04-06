import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  FileText,
  Users,
  ArrowRight,
  CheckCircle2,
  BadgeIndianRupee,
  Sparkles
} from "lucide-react";
import { BecomeOwnerClient } from "../../../components/become-owner-client";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "अपनी प्रॉपर्टी लिस्ट करें" : "List Your Property";
  const description = isHindi
    ? "Cribliv पर अपनी प्रॉपर्टी फ्री में लिस्ट करें। शून्य कमीशन, सत्यापित किरायेदार, AI-मैच्ड लीड।"
    : "List your property on Cribliv for free. Zero commission, verified tenants, AI-matched leads across North India.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/become-owner`,
      languages: { en: `${BASE_URL}/en/become-owner`, hi: `${BASE_URL}/hi/become-owner` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/become-owner`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

const STEPS = [
  {
    icon: FileText,
    title: "Create Your Listing",
    titleHi: "लिस्टिंग बनाएं",
    desc: "Fill in property details or use our voice-assisted AI to generate your listing in under 5 minutes.",
    descHi: "प्रॉपर्टी डिटेल भरें या 5 मिनट में AI असिस्टेंट से लिस्टिंग बनाएं।"
  },
  {
    icon: ShieldCheck,
    title: "Get Verified",
    titleHi: "वेरिफाई हों",
    desc: "Complete a quick Aadhaar or electricity bill verification. Verified owners get 3x more leads.",
    descHi:
      "आधार या बिजली बिल से तुरंत वेरिफिकेशन करें। वेरिफाइड ओनर को 3 गुना ज़्यादा लीड मिलती हैं।"
  },
  {
    icon: Users,
    title: "Receive Tenant Leads",
    titleHi: "किरायेदार लीड पाएं",
    desc: "AI matches your property with serious tenants. Get direct enquiries — no brokers in between.",
    descHi: "AI आपकी प्रॉपर्टी को सही किरायेदारों से जोड़ता है। बिना ब्रोकर के सीधी पूछताछ।"
  }
];

const TRUST_POINTS = [
  { text: "Zero commission forever", textHi: "हमेशा शून्य कमीशन" },
  { text: "AI-matched tenant leads", textHi: "AI-मैच्ड किरायेदार" },
  { text: "Verified badge for trust", textHi: "भरोसे के लिए वेरिफाइड बैज" }
];

export default function BecomeOwnerPage({ params }: { params: { locale: string } }) {
  const isHindi = params.locale === "hi";

  return (
    <>
      {/* Hero */}
      <section
        className="hero--landing"
        style={{ paddingTop: "var(--space-16)", paddingBottom: "var(--space-10)" }}
      >
        <div className="hero-glow" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <p
            className="overline animate-in"
            style={{ color: "rgba(255,255,255,0.5)", marginBottom: "var(--space-3)" }}
          >
            <Sparkles
              size={14}
              style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
            />
            {isHindi ? "प्रॉपर्टी ओनर के लिए" : "For Property Owners"}
          </p>
          <h1
            className="display animate-in animate-in-delay-1"
            style={{ maxWidth: 650, margin: "0 auto var(--space-5)" }}
          >
            {isHindi ? "Cribliv पर अपनी प्रॉपर्टी लिस्ट करें" : "List Your Property on Cribliv"}
          </h1>
          <p
            className="hero-subtitle animate-in animate-in-delay-2"
            style={{ maxWidth: 520, margin: "0 auto var(--space-8)" }}
          >
            {isHindi
              ? "शून्य कमीशन। सत्यापित किरायेदार। AI-मैच्ड लीड — सब कुछ फ्री।"
              : "Zero commission. Verified tenants. AI-matched leads — all for free. Join hundreds of owners across North India."}
          </p>
          <Link
            href={`/${params.locale}/owner/listings/new`}
            className="btn btn--lg animate-in animate-in-delay-3"
          >
            {isHindi ? "अभी लिस्ट करें" : "Start Listing Now"} <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* 3-Step Process */}
      <section className="section--sm">
        <div
          className="section-header"
          style={{ justifyContent: "center", marginBottom: "var(--space-8)" }}
        >
          <div style={{ textAlign: "center" }}>
            <p
              className="overline"
              style={{ marginBottom: "var(--space-2)", color: "var(--brand)" }}
            >
              {isHindi ? "सरल प्रक्रिया" : "How It Works"}
            </p>
            <h2>{isHindi ? "3 आसान कदम" : "3 Simple Steps to Start Earning"}</h2>
          </div>
        </div>
        <div className="grid grid-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className="feature-card">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    marginBottom: "var(--space-4)",
                    justifyContent: "center"
                  }}
                >
                  <span className="step-number step-number--brand">{i + 1}</span>
                </div>
                <div
                  className="icon-circle icon-circle--brand"
                  style={{ margin: "0 auto var(--space-4)" }}
                  aria-hidden="true"
                >
                  <Icon size={24} />
                </div>
                <h3 className="feature-card__title">{isHindi ? step.titleHi : step.title}</h3>
                <p className="feature-card__desc">{isHindi ? step.descHi : step.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust Row */}
      <section className="section--sm" style={{ paddingTop: 0 }}>
        <div
          className="trust-strip"
          style={{
            maxWidth: 700,
            margin: "0 auto"
          }}
        >
          {TRUST_POINTS.map((point) => (
            <span key={point.text} className="trust-strip__item">
              <CheckCircle2 size={16} style={{ color: "var(--trust)" }} />
              {isHindi ? point.textHi : point.text}
            </span>
          ))}
        </div>
      </section>

      {/* Stats Row */}
      <section className="section--sm" style={{ paddingTop: 0, paddingBottom: "var(--space-4)" }}>
        <div className="grid grid-3" style={{ maxWidth: 600, margin: "0 auto" }}>
          <div className="feature-card" style={{ textAlign: "center", padding: "var(--space-5)" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 28,
                fontWeight: 800,
                color: "var(--brand)"
              }}
            >
              100%
            </div>
            <div className="body-sm text-secondary" style={{ marginTop: "var(--space-1)" }}>
              {isHindi ? "फ्री लिस्टिंग" : "Free to List"}
            </div>
          </div>
          <div className="feature-card" style={{ textAlign: "center", padding: "var(--space-5)" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 28,
                fontWeight: 800,
                color: "var(--trust)"
              }}
            >
              3x
            </div>
            <div className="body-sm text-secondary" style={{ marginTop: "var(--space-1)" }}>
              {isHindi ? "ज़्यादा लीड (वेरिफाइड)" : "More Leads (Verified)"}
            </div>
          </div>
          <div className="feature-card" style={{ textAlign: "center", padding: "var(--space-5)" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 28,
                fontWeight: 800,
                color: "var(--brand)"
              }}
            >
              8
            </div>
            <div className="body-sm text-secondary" style={{ marginTop: "var(--space-1)" }}>
              {isHindi ? "शहर" : "Cities Covered"}
            </div>
          </div>
        </div>
      </section>

      {/* Role Upgrade Form */}
      <section className="section" style={{ paddingTop: "var(--space-8)" }}>
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            paddingLeft: "var(--space-6)",
            paddingRight: "var(--space-6)"
          }}
        >
          <BecomeOwnerClient locale={params.locale} />
        </div>
      </section>

      {/* CTA Banner */}
      <section
        className="cta-banner"
        style={{ marginLeft: "var(--space-6)", marginRight: "var(--space-6)" }}
      >
        <h2>{isHindi ? "आज ही शुरू करें" : "Ready to list your property?"}</h2>
        <p>
          {isHindi
            ? "5 मिनट में AI-सत्यापित लिस्टिंग बनाएं।"
            : "Create an AI-verified listing in under 5 minutes. No fees, no commission, ever."}
        </p>
        <Link href={`/${params.locale}/owner/listings/new`} className="btn btn--lg">
          {isHindi ? "अभी लिस्ट करें" : "Create Listing"} <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
