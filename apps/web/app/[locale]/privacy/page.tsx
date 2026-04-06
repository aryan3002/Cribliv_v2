import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "गोपनीयता नीति" : "Privacy Policy";
  const description = isHindi
    ? "Cribliv की गोपनीयता नीति — हम आपकी व्यक्तिगत जानकारी कैसे एकत्र, उपयोग और सुरक्षित करते हैं।"
    : "Cribliv Privacy Policy — how we collect, use, store, and protect your personal information when you use our verified rental platform.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/privacy`,
      languages: { en: `${BASE_URL}/en/privacy`, hi: `${BASE_URL}/hi/privacy` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/privacy`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

export default function PrivacyPolicyPage({ params }: { params: { locale: string } }) {
  const lastUpdated = "February 28, 2026";

  return (
    <div
      className="container--narrow"
      style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-16)" }}
    >
      <h1 style={{ marginBottom: "var(--space-2)" }}>Privacy Policy</h1>
      <p className="text-secondary body-sm" style={{ marginBottom: "var(--space-8)" }}>
        Last updated: {lastUpdated}
      </p>

      <div
        className="legal-content"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      >
        <section>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            This Privacy Policy describes the policies and procedures of Cribliv Ventures Private
            Limited (&quot;Cribliv,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            regarding the collection, use, and disclosure of your information when you use our
            platform at cribliv.com (&quot;the Service&quot;). By using our Service, you agree to
            the collection and use of information in accordance with this Privacy Policy.
          </p>
        </section>

        <section>
          <h2>1. Information We Collect</h2>
          <h3 style={{ marginTop: "var(--space-4)" }}>1.1 Personal Data</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            When you create an account or use our Service, we may collect the following personally
            identifiable information:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>Phone number (used for OTP-based authentication)</li>
            <li>Full name (optional, provided in account settings)</li>
            <li>Preferred language preference (English or Hindi)</li>
            <li>WhatsApp notification opt-in preference</li>
            <li>Property listing details (for property owners)</li>
            <li>Aadhaar verification data (for owner verification, processed securely)</li>
          </ul>

          <h3 style={{ marginTop: "var(--space-4)" }}>1.2 Usage Data</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We automatically collect usage data including your device&apos;s IP address, browser
            type, pages visited, time and date of visits, time spent on pages, search queries, and
            other diagnostic data.
          </p>

          <h3 style={{ marginTop: "var(--space-4)" }}>1.3 Payment Data</h3>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Payment transactions for contact unlock fees are processed through secure third-party
            payment processors. We do not store your complete payment card details on our servers.
          </p>
        </section>

        <section>
          <h2>2. How We Use Your Information</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We use your personal data to:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>Provide and maintain our rental search and listing Service</li>
            <li>Authenticate your identity via OTP verification</li>
            <li>Process contact unlock transactions and manage your wallet credits</li>
            <li>Verify property owner identity through Aadhaar verification</li>
            <li>Send you WhatsApp notifications about owner responses (if opted in)</li>
            <li>Power AI-driven search features including natural language and voice search</li>
            <li>Improve and personalize your experience on the platform</li>
            <li>Enforce our 12-hour refund guarantee policy</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2>3. Data Sharing</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We do not sell your personal information to third parties. We may share your data with:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>
              <strong>Property owners:</strong> Your phone number is shared with an owner only after
              you unlock their contact (and pay the unlock fee)
            </li>
            <li>
              <strong>Payment processors:</strong> To process contact unlock fee transactions
              securely
            </li>
            <li>
              <strong>Verification providers:</strong> For Aadhaar-based owner identity verification
            </li>
            <li>
              <strong>Legal authorities:</strong> When required by law or to protect our rights
            </li>
          </ul>
        </section>

        <section>
          <h2>4. Data Retention</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We retain your personal data for as long as your account is active or as needed to
            provide you services. You may request deletion of your account and personal data by
            contacting us at help@cribliv.com. Transaction records may be retained for legal and
            accounting purposes.
          </p>
        </section>

        <section>
          <h2>5. Data Security</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We implement industry-standard security measures to protect your personal data,
            including encrypted data transmission (HTTPS/TLS), secure OTP-based authentication,
            hashed password storage, and access controls. However, no method of electronic
            transmission or storage is 100% secure.
          </p>
        </section>

        <section>
          <h2>6. Cookies and Tracking</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We use essential cookies to maintain your session and authentication state. We may also
            use analytics cookies to understand how our Service is used and to improve the user
            experience. You can configure your browser to refuse cookies, though this may limit some
            functionality.
          </p>
        </section>

        <section>
          <h2>7. Your Rights</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            You have the right to:
          </p>
          <ul className="text-secondary" style={{ lineHeight: 2, paddingLeft: "var(--space-6)" }}>
            <li>Access the personal data we hold about you</li>
            <li>Update or correct your personal information via account settings</li>
            <li>Request deletion of your personal data</li>
            <li>Opt out of WhatsApp notifications at any time</li>
            <li>Withdraw consent for data processing</li>
          </ul>
        </section>

        <section>
          <h2>8. Children&apos;s Privacy</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            Our Service is not intended for anyone under the age of 18. We do not knowingly collect
            personal data from minors. If you believe a minor has provided us with personal data,
            please contact us to have it removed.
          </p>
        </section>

        <section>
          <h2>9. Changes to This Policy</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            We may update this Privacy Policy from time to time. We will notify you of any material
            changes by posting the updated policy on this page and updating the &quot;Last
            updated&quot; date. Continued use of the Service after changes constitutes acceptance.
          </p>
        </section>

        <section>
          <h2>10. Contact Us</h2>
          <p className="text-secondary" style={{ lineHeight: 1.8 }}>
            If you have questions about this Privacy Policy or our data practices, contact us:
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
