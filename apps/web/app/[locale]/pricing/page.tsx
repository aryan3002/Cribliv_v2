import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "किफायती मूल्य निर्धारण" : "Transparent Pricing — Zero Brokerage Rentals";
  const description = isHindi
    ? "Cribliv पर पारदर्शी मूल्य — शून्य ब्रोकरेज, सस्ता कॉन्टैक्ट अनलॉक, 12 घंटे की रिफंड गारंटी।"
    : "Cribliv pricing explained — zero brokerage, affordable contact unlock fees, wallet credits, and 12-hour refund guarantee. No hidden charges.";

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/pricing`,
      languages: { en: `${BASE_URL}/en/pricing`, hi: `${BASE_URL}/hi/pricing` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/pricing`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

function breadcrumbJsonLd(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${locale}` },
      { "@type": "ListItem", position: 2, name: "Pricing", item: `${BASE_URL}/${locale}/pricing` }
    ]
  };
}

const HOW_IT_WORKS_STEPS = [
  {
    icon: "🔍",
    title: "Search for Free",
    desc: "Browse thousands of verified rental listings across 8 cities — completely free. Use AI-powered search or voice commands in Hindi and English."
  },
  {
    icon: "💳",
    title: "Add Wallet Credits",
    desc: "Purchase wallet credits securely via UPI or card. Credits never expire and sit in your wallet until you need them."
  },
  {
    icon: "🔓",
    title: "Unlock Owner Contact",
    desc: "Found a property you like? Pay a small contact unlock fee to get the owner's direct phone number. No broker, no middlemen."
  },
  {
    icon: "🏠",
    title: "Connect & Move In",
    desc: "Call the owner directly, schedule a visit, and finalize your rental agreement. Cribliv is not involved in the rental deal — you save 100% on brokerage."
  }
];

const COMPARISON = [
  { feature: "Brokerage", cribliv: "₹0", broker: "1–2 months rent" },
  { feature: "Verified Owners", cribliv: "✓ Aadhaar verified", broker: "✗ No verification" },
  { feature: "Direct Owner Contact", cribliv: "✓ Instant", broker: "✗ Via broker" },
  { feature: "Refund Guarantee", cribliv: "✓ 12-hour auto-refund", broker: "✗ None" },
  { feature: "Hidden Charges", cribliv: "✗ None", broker: "✓ Common" },
  { feature: "AI + Voice Search", cribliv: "✓ Hindi & English", broker: "✗ Not available" }
];

export default function PricingPage({ params }: { params: { locale: string } }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(params.locale)) }}
      />

      <div style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-16)" }}>
        {/* Hero */}
        <div
          className="container--narrow"
          style={{ textAlign: "center", marginBottom: "var(--space-12)" }}
        >
          <nav
            className="breadcrumb"
            style={{ marginBottom: "var(--space-6)", fontSize: "var(--text-sm)" }}
          >
            <a
              href={`/${params.locale}`}
              className="text-secondary"
              style={{ textDecoration: "none" }}
            >
              Home
            </a>
            <span className="text-tertiary" style={{ margin: "0 var(--space-2)" }}>
              {" / "}
            </span>
            <span className="text-primary">Pricing</span>
          </nav>

          <h1 style={{ marginBottom: "var(--space-3)" }}>Simple, Transparent Pricing</h1>
          <p
            className="text-secondary body-lg"
            style={{ maxWidth: 600, margin: "0 auto var(--space-6)" }}
          >
            Zero brokerage. Zero hidden charges. Pay only a small fee to unlock an owner&apos;s
            direct contact — and get an automatic refund if they don&apos;t respond.
          </p>

          {/* Price card */}
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              background: "white",
              border: "2px solid var(--brand)",
              borderRadius: "var(--radius-xl)",
              padding: "var(--space-8) var(--space-10)",
              boxShadow: "var(--shadow-lg)",
              maxWidth: 380
            }}
          >
            <span
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "var(--brand)",
                textTransform: "uppercase",
                letterSpacing: "0.05em"
              }}
            >
              Contact Unlock
            </span>
            <div
              style={{ fontSize: 48, fontWeight: 800, marginTop: "var(--space-2)", lineHeight: 1 }}
            >
              ₹<span style={{ fontSize: 64 }}>49</span>
            </div>
            <span className="text-secondary" style={{ marginTop: "var(--space-1)" }}>
              per property contact
            </span>

            <div
              style={{
                width: "100%",
                borderTop: "1px solid var(--border)",
                margin: "var(--space-5) 0",
                paddingTop: "var(--space-5)"
              }}
            >
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)"
                }}
              >
                {[
                  "Owner's direct phone number",
                  "12-hour auto-refund guarantee",
                  "Zero brokerage forever",
                  "Wallet credits never expire"
                ].map((item) => (
                  <li
                    key={item}
                    style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
                  >
                    <span style={{ color: "var(--trust)", fontWeight: 700 }}>✓</span>
                    <span className="text-secondary" style={{ fontSize: "var(--text-sm)" }}>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <a
              href={`/${params.locale}/search`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "var(--space-4)",
                padding: "var(--space-3) var(--space-8)",
                background: "var(--brand)",
                color: "white",
                borderRadius: "var(--radius-full)",
                fontWeight: 600,
                textDecoration: "none",
                width: "100%"
              }}
            >
              Start Searching
            </a>
          </div>
        </div>

        {/* How It Works */}
        <div className="section--alt" style={{ padding: "var(--space-12) 0" }}>
          <div className="container">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>How It Works</h2>
            <div className="grid grid-4" style={{ gap: "var(--space-6)" }}>
              {HOW_IT_WORKS_STEPS.map((step, i) => (
                <div key={step.title} className="feature-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: "var(--space-3)" }}>{step.icon}</div>
                  <div
                    className="step-number"
                    style={{
                      margin: "0 auto var(--space-2)",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--brand)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--text-sm)",
                      fontWeight: 700
                    }}
                  >
                    {i + 1}
                  </div>
                  <h3 style={{ fontSize: "var(--text-base)", marginBottom: "var(--space-2)" }}>
                    {step.title}
                  </h3>
                  <p className="text-secondary body-sm">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="container--narrow" style={{ padding: "var(--space-12) 0" }}>
          <h2 style={{ textAlign: "center", marginBottom: "var(--space-2)" }}>
            Cribliv vs Traditional Brokers
          </h2>
          <p
            className="text-secondary"
            style={{ textAlign: "center", marginBottom: "var(--space-8)" }}
          >
            See why thousands of tenants choose Cribliv.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "white",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                boxShadow: "var(--shadow-sm)"
              }}
            >
              <thead>
                <tr style={{ background: "var(--brand)", color: "white" }}>
                  <th
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      textAlign: "left",
                      fontWeight: 600
                    }}
                  >
                    Feature
                  </th>
                  <th
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      textAlign: "center",
                      fontWeight: 600
                    }}
                  >
                    Cribliv
                  </th>
                  <th
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      textAlign: "center",
                      fontWeight: 600
                    }}
                  >
                    Broker
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "white" : "var(--surface)"
                    }}
                  >
                    <td style={{ padding: "var(--space-3) var(--space-5)", fontWeight: 500 }}>
                      {row.feature}
                    </td>
                    <td
                      style={{
                        padding: "var(--space-3) var(--space-5)",
                        textAlign: "center",
                        color: "var(--trust)",
                        fontWeight: 600
                      }}
                    >
                      {row.cribliv}
                    </td>
                    <td
                      style={{ padding: "var(--space-3) var(--space-5)", textAlign: "center" }}
                      className="text-secondary"
                    >
                      {row.broker}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trust Guarantees */}
        <div className="section--alt" style={{ padding: "var(--space-12) 0" }}>
          <div className="container">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>Our Guarantees</h2>
            <div className="grid grid-3" style={{ gap: "var(--space-6)" }}>
              {[
                {
                  icon: "🛡️",
                  title: "12-Hour Refund",
                  desc: "If the owner doesn't respond within 12 hours, your unlock fee is automatically refunded to your wallet."
                },
                {
                  icon: "✅",
                  title: "Aadhaar Verified",
                  desc: "Every property owner completes Aadhaar identity verification before listing. You deal only with real, verified owners."
                },
                {
                  icon: "🚫",
                  title: "Zero Brokerage",
                  desc: "We never charge brokerage — not 1 month, not half month, nothing. The rental deal is 100% between you and the owner."
                }
              ].map((g) => (
                <div key={g.title} className="feature-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: "var(--space-3)" }}>{g.icon}</div>
                  <h3 style={{ marginBottom: "var(--space-2)" }}>{g.title}</h3>
                  <p className="text-secondary body-sm">{g.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          className="container--narrow"
          style={{ padding: "var(--space-12) 0", textAlign: "center" }}
        >
          <h2 style={{ marginBottom: "var(--space-3)" }}>Ready to find your next home?</h2>
          <p className="text-secondary" style={{ marginBottom: "var(--space-6)" }}>
            Join thousands of tenants saving lakhs on brokerage with Cribliv.
          </p>
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              justifyContent: "center",
              flexWrap: "wrap"
            }}
          >
            <a
              href={`/${params.locale}/search`}
              className="btn btn--primary"
              style={{
                padding: "var(--space-3) var(--space-8)",
                borderRadius: "var(--radius-full)",
                fontWeight: 600,
                textDecoration: "none"
              }}
            >
              Search Rentals
            </a>
            <a
              href={`/${params.locale}/become-owner`}
              className="btn btn--secondary"
              style={{
                padding: "var(--space-3) var(--space-8)",
                borderRadius: "var(--radius-full)",
                fontWeight: 600,
                textDecoration: "none"
              }}
            >
              List Your Property
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
