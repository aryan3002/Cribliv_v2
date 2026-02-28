import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "सेवा की शर्तें — Cribliv" : "Terms of Service — Cribliv";
  const description = isHindi
    ? "Cribliv की सेवा की शर्तें — प्लेटफॉर्म उपयोग, भुगतान, रिफंड नीति और उपयोगकर्ता जिम्मेदारियाँ।"
    : "Cribliv Terms of Service — platform usage, payments, 12-hour refund policy, user responsibilities, and property listing guidelines.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/terms`,
      languages: { en: `${BASE_URL}/en/terms`, hi: `${BASE_URL}/hi/terms` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/terms`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

export default function TermsPage({ params }: { params: { locale: string } }) {
  const lastUpdated = "February 28, 2026";

  return (
    <div
      className="container--narrow"
      style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-16)" }}
    >
      <h1 style={{ marginBottom: "var(--space-2)" }}>Terms of Service</h1>
      <p className="text-secondary body-sm" style={{ marginBottom: "var(--space-8)" }}>
        Last updated: {lastUpdated}
      </p>

      <div
        className="legal-content"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      >
        <section>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Welcome to Cribliv. These Terms of Service (&quot;Terms&quot;) govern your use of the
            Cribliv platform operated by Cribliv Ventures Private Limited (&quot;Company,&quot;
            &quot;we,&quot; &quot;us&quot;). By accessing or using cribliv.com (&quot;the
            Service&quot;), you agree to be bound by these Terms.
          </p>
        </section>

        <section>
          <h2>1. Eligibility</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            You must be at least 18 years of age and have the legal capacity to enter into a binding
            agreement to use our Service. By registering, you represent and warrant that you meet
            these eligibility requirements.
          </p>
        </section>

        <section>
          <h2>2. Account Registration</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            To access certain features, you must register using a valid Indian mobile phone number
            (+91). Authentication is performed via one-time password (OTP). You are responsible for
            maintaining the confidentiality of your account and for all activities under your
            account.
          </p>
        </section>

        <section>
          <h2>3. Platform Services</h2>
          <h3 style={{ marginTop: "var(--space-4)" }}>3.1 For Tenants</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Cribliv provides a search platform to discover verified rental properties (flats,
            houses, PGs) across supported cities in North India. You may browse listings for free.
            To access a property owner&apos;s direct contact details, you must pay a contact unlock
            fee using wallet credits.
          </p>

          <h3 style={{ marginTop: "var(--space-4)" }}>3.2 For Property Owners</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Property owners may list their properties on Cribliv after completing Aadhaar identity
            verification. All listings are subject to review and must contain accurate information.
            Misleading or fraudulent listings will be removed, and the account may be suspended.
          </p>

          <h3 style={{ marginTop: "var(--space-4)" }}>3.3 Verification</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Cribliv verifies property owner identity through Aadhaar OTP and property document
            checks. While we take reasonable steps to verify listings, Cribliv does not guarantee
            the accuracy of all listing details and is not a party to any rental agreement between
            tenants and owners.
          </p>
        </section>

        <section>
          <h2>4. Payments & Pricing</h2>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>
              <strong>Contact Unlock Fee:</strong> A small fee is charged to reveal a property
              owner&apos;s contact details. This fee is non-refundable except under the 12-hour
              guarantee.
            </li>
            <li>
              <strong>Wallet Credits:</strong> Credits are purchased via UPI or card payment and
              used to unlock contacts. Unused credits remain in your wallet with no expiry.
            </li>
            <li>
              <strong>Zero Brokerage:</strong> Cribliv charges zero brokerage. There are no hidden
              fees beyond the contact unlock fee.
            </li>
          </ul>
        </section>

        <section>
          <h2>5. 12-Hour Refund Guarantee</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            If a property owner does not respond to your inquiry within 12 hours of you unlocking
            their contact, your unlock fee is automatically refunded to your Cribliv wallet. This
            guarantee applies to all verified listings. Refund credits can be used for future
            unlocks.
          </p>
        </section>

        <section>
          <h2>6. Prohibited Conduct</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            You agree not to:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>Provide false or misleading information in your profile or listings</li>
            <li>Use the platform for any illegal purpose</li>
            <li>Attempt to bypass payment mechanisms or security features</li>
            <li>Harass, threaten, or abuse other users</li>
            <li>Scrape, crawl, or use automated tools to extract data from the platform</li>
            <li>Create multiple accounts to abuse promotional credits</li>
            <li>Impersonate another person or entity</li>
          </ul>
        </section>

        <section>
          <h2>7. Intellectual Property</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            All content, features, and functionality of the Service — including the Cribliv name,
            logo, AI search algorithms, and design — are owned by Cribliv Ventures Private Limited
            and are protected by intellectual property laws. You may not copy, modify, distribute,
            or create derivative works without prior written consent.
          </p>
        </section>

        <section>
          <h2>8. Limitation of Liability</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Cribliv is a platform that connects tenants with property owners. We are not a party to
            any rental agreement, nor do we guarantee the condition, legality, or suitability of any
            listed property. Our liability is limited to the amount of fees paid by you to Cribliv
            in the 12 months preceding the claim.
          </p>
        </section>

        <section>
          <h2>9. Termination</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We may suspend or terminate your account at our sole discretion for violation of these
            Terms. You may delete your account at any time by contacting help@cribliv.com. Upon
            termination, your right to use the Service ceases immediately. Any unused wallet credits
            may be forfeited upon termination for cause.
          </p>
        </section>

        <section>
          <h2>10. Governing Law</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            These Terms are governed by and construed in accordance with the laws of India. Any
            disputes arising from these Terms shall be subject to the exclusive jurisdiction of the
            courts in Lucknow, Uttar Pradesh, India.
          </p>
        </section>

        <section>
          <h2>11. Changes to Terms</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We reserve the right to modify these Terms at any time. Material changes will be
            notified via the platform or email. Continued use of the Service after changes
            constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2>12. Contact</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            For questions about these Terms, contact us:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>
              <strong>Email:</strong> help@cribliv.com
            </li>
            <li>
              <strong>Company:</strong> Cribliv Ventures Private Limited
            </li>
            <li>
              <strong>Address:</strong> SS-271 Sector C-1, LDA Colony, Kanpur Road, Lucknow, Uttar
              Pradesh, India
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
