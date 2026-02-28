import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const FAQ_DATA = [
  {
    category: "Getting Started",
    items: [
      {
        q: "What is Cribliv?",
        a: "Cribliv is North India's first AI-driven rental platform that connects tenants directly with verified property owners — with zero brokerage. We list flats, houses, and PGs across Delhi NCR, Lucknow, Jaipur, and Chandigarh."
      },
      {
        q: "How does Cribliv work?",
        a: "Search for rentals using our AI-powered search (including voice commands in Hindi and English). Browse verified listings for free. When you find a property you like, pay a small contact unlock fee to get the owner's direct phone number. No middlemen, no brokers — just direct owner-tenant connections."
      },
      {
        q: "Is Cribliv free to use?",
        a: "Browsing and searching listings is completely free. To unlock a property owner's contact details, you pay a small fee using wallet credits. There is zero brokerage — you deal directly with the owner."
      },
      {
        q: "Which cities does Cribliv cover?",
        a: "Cribliv currently covers 8 cities in North India: Delhi, Noida, Gurugram (Gurgaon), Ghaziabad, Faridabad, Chandigarh, Jaipur, and Lucknow. We are expanding to more cities soon."
      }
    ]
  },
  {
    category: "Payments & Pricing",
    items: [
      {
        q: "How much does it cost to unlock a contact?",
        a: "The contact unlock fee is a small, transparent amount clearly displayed before you unlock. Exact pricing varies — check the current rate on any listing page. There are no hidden charges."
      },
      {
        q: "What are wallet credits?",
        a: "Wallet credits are Cribliv's in-platform currency. You purchase credits via UPI or card, and use them to unlock property owner contacts. Unused credits never expire and stay in your wallet."
      },
      {
        q: "Does Cribliv charge brokerage?",
        a: "No. Cribliv charges absolutely zero brokerage. You only pay the small contact unlock fee. The rental agreement is directly between you and the property owner."
      }
    ]
  },
  {
    category: "Refunds & Guarantees",
    items: [
      {
        q: "What is the 12-hour refund guarantee?",
        a: "If a property owner does not respond to your inquiry within 12 hours of unlocking their contact, your unlock fee is automatically refunded to your Cribliv wallet. No questions asked."
      },
      {
        q: "How do I get a refund?",
        a: "Refunds under the 12-hour guarantee are processed automatically to your Cribliv wallet. For other refund requests, contact help@cribliv.com with your account details and transaction reference."
      },
      {
        q: "Can I get a cash refund instead of wallet credits?",
        a: "The 12-hour guarantee refunds are credited to your wallet for convenience. For exceptional circumstances, contact our support team at help@cribliv.com to discuss alternative refund options."
      }
    ]
  },
  {
    category: "For Property Owners",
    items: [
      {
        q: "How do I list my property on Cribliv?",
        a: "Sign up with your phone number, select 'Become an Owner', complete Aadhaar identity verification, and then add your property details, photos, and rental terms. Listing is free for property owners."
      },
      {
        q: "What verification is required?",
        a: "Property owners must verify their identity via Aadhaar OTP. We may also require property ownership documents to ensure listing authenticity. This protects tenants and builds trust."
      },
      {
        q: "Is listing a property free?",
        a: "Yes, property listing on Cribliv is completely free. Owners benefit from connected, verified tenants without any listing charges."
      }
    ]
  },
  {
    category: "Safety & Trust",
    items: [
      {
        q: "How does Cribliv verify listings?",
        a: "Every property owner undergoes Aadhaar identity verification. We also verify property documents and may perform physical inspections for selected listings. Verified listings carry a verification badge."
      },
      {
        q: "Is my personal data safe?",
        a: "Yes. We use industry-standard encryption, secure OTP-based authentication, and do not store Aadhaar numbers after verification. Read our full Privacy Policy for details."
      },
      {
        q: "What if I encounter a fraudulent listing?",
        a: "Report it immediately through the platform or email help@cribliv.com. We investigate all reports promptly and remove fraudulent listings. Your unlock fee will be refunded for confirmed fraudulent listings."
      }
    ]
  },
  {
    category: "Features & Search",
    items: [
      {
        q: "Does Cribliv support voice search?",
        a: "Yes! Cribliv supports AI-powered voice search in both Hindi and English. Just tap the microphone icon and speak naturally — e.g., 'Noida mein 2BHK chahiye 15 hazaar tak' or 'Show me PGs in Gurugram under 10000'."
      },
      {
        q: "Can I save properties to a shortlist?",
        a: "Yes. Use the heart icon on any listing to save it to your shortlist. Access your saved properties anytime from the shortlist page."
      },
      {
        q: "Is Cribliv available in Hindi?",
        a: "Yes, Cribliv is fully available in both English and Hindi. You can switch languages from the header or set your preferred language in account settings."
      }
    ]
  }
];

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi
    ? "अक्सर पूछे जाने वाले प्रश्न — Cribliv"
    : "Frequently Asked Questions — Cribliv";
  const description = isHindi
    ? "Cribliv के FAQ — किराये की खोज, भुगतान, रिफंड, मालिक सत्यापन और बहुत कुछ।"
    : "Find answers to common questions about Cribliv — rental search, pricing, 12-hour refund guarantee, owner verification, voice search, and more.";

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/faq`,
      languages: { en: `${BASE_URL}/en/faq`, hi: `${BASE_URL}/hi/faq` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/faq`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

function faqJsonLd() {
  const allItems = FAQ_DATA.flatMap((cat) => cat.items);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: allItems.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a
      }
    }))
  };
}

function breadcrumbJsonLd(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${locale}` },
      { "@type": "ListItem", position: 2, name: "FAQ", item: `${BASE_URL}/${locale}/faq` }
    ]
  };
}

export default function FAQPage({ params }: { params: { locale: string } }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(params.locale)) }}
      />

      <div
        className="container--narrow"
        style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-16)" }}
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
            /
          </span>
          <span className="text-primary">FAQ</span>
        </nav>

        <h1 style={{ marginBottom: "var(--space-3)" }}>Frequently Asked Questions</h1>
        <p
          className="text-secondary body-lg"
          style={{ marginBottom: "var(--space-10)", maxWidth: 640 }}
        >
          Everything you need to know about using Cribliv to find your perfect rental home — from
          searching and payments to owner verification and refunds.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          {FAQ_DATA.map((category) => (
            <section key={category.category}>
              <h2
                style={{
                  fontSize: "var(--text-xl)",
                  marginBottom: "var(--space-4)",
                  color: "var(--brand)"
                }}
              >
                {category.category}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                {category.items.map((item) => (
                  <details
                    key={item.q}
                    className="faq-item"
                    style={{
                      background: "white",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border)",
                      overflow: "hidden"
                    }}
                  >
                    <summary
                      style={{
                        padding: "var(--space-4) var(--space-5)",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "var(--text-base)",
                        listStyle: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between"
                      }}
                    >
                      {item.q}
                      <span
                        style={{
                          marginLeft: "var(--space-3)",
                          flexShrink: 0,
                          transition: "transform 0.2s"
                        }}
                      >
                        ▸
                      </span>
                    </summary>
                    <div
                      style={{
                        padding: "0 var(--space-5) var(--space-4)",
                        lineHeight: 1.75
                      }}
                      className="text-secondary"
                    >
                      {item.a}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Contact CTA */}
        <div
          style={{
            marginTop: "var(--space-12)",
            padding: "var(--space-8)",
            background: "linear-gradient(135deg, var(--brand), #0052CC)",
            borderRadius: "var(--radius-xl)",
            textAlign: "center",
            color: "white"
          }}
        >
          <h2 style={{ color: "white", marginBottom: "var(--space-2)" }}>Still have questions?</h2>
          <p style={{ opacity: 0.9, marginBottom: "var(--space-5)" }}>
            Our support team is available to help you find your perfect home.
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
              href="mailto:help@cribliv.com"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-6)",
                background: "white",
                color: "var(--brand)",
                borderRadius: "var(--radius-full)",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "var(--text-sm)"
              }}
            >
              Email Us
            </a>
            <a
              href="https://wa.me/911203251801"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-6)",
                background: "rgba(255,255,255,0.15)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "var(--radius-full)",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "var(--text-sm)"
              }}
            >
              WhatsApp
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
