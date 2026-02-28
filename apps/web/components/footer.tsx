import Link from "next/link";
import Image from "next/image";
import type { Locale } from "../lib/i18n";
import { Heart, Mail, ShieldCheck, Phone } from "lucide-react";

export function Footer({ locale }: { locale: Locale }) {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          {/* Brand column */}
          <div>
            <div
              className="footer__brand"
              style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
            >
              <Image src="/cribliv.png" alt="" width={32} height={30} style={{ opacity: 0.9 }} />
              Cribliv
            </div>
            <p className="footer__description">
              AI-powered verified rental search for North India. Find flats, PGs, and houses with
              owner verification and a 12-hour refund guarantee.
            </p>
            <div
              style={{
                display: "flex",
                gap: "var(--space-3)",
                marginTop: "var(--space-4)",
                alignItems: "center"
              }}
            >
              <ShieldCheck size={16} style={{ color: "var(--trust)" }} />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                Verified owners only
              </span>
            </div>
          </div>

          {/* Explore */}
          <div>
            <p className="footer__heading" role="heading" aria-level={2}>
              Explore
            </p>
            <div className="footer__links">
              <Link href={`/${locale}/search`} className="footer__link">
                Search Rentals
              </Link>
              <Link href={`/${locale}/how-it-works`} className="footer__link">
                How It Works
              </Link>
              <Link href={`/${locale}/city/noida`} className="footer__link">
                Noida
              </Link>
              <Link href={`/${locale}/city/delhi`} className="footer__link">
                Delhi
              </Link>
              <Link href={`/${locale}/city/gurugram`} className="footer__link">
                Gurugram
              </Link>
            </div>
          </div>

          {/* For Owners */}
          <div>
            <p className="footer__heading" role="heading" aria-level={2}>
              For Owners
            </p>
            <div className="footer__links">
              <Link href={`/${locale}/become-owner`} className="footer__link">
                List Your Property
              </Link>
              <Link href={`/${locale}/owner/dashboard`} className="footer__link">
                Owner Dashboard
              </Link>
              <Link href={`/${locale}/owner/verification`} className="footer__link">
                Verification
              </Link>
            </div>
          </div>

          {/* Support */}
          <div>
            <p className="footer__heading" role="heading" aria-level={2}>
              Company
            </p>
            <div className="footer__links">
              <Link href={`/${locale}/about`} className="footer__link">
                About Us
              </Link>
              <Link href={`/${locale}/contact`} className="footer__link">
                Contact
              </Link>
              <a
                href="mailto:help@cribliv.com"
                className="footer__link"
                style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
              >
                <Mail size={14} /> help@cribliv.com
              </a>
              <Link href={`/${locale}/privacy`} className="footer__link">
                Privacy Policy
              </Link>
              <Link href={`/${locale}/terms`} className="footer__link">
                Terms of Service
              </Link>
              <Link href={`/${locale}/faq`} className="footer__link">
                FAQ
              </Link>
              <Link href={`/${locale}/pricing`} className="footer__link">
                Pricing
              </Link>
            </div>
          </div>
        </div>

        <hr className="footer__divider" />

        <div className="footer__bottom">
          <span>&copy; {year} Cribliv. All rights reserved.</span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            Made with <Heart size={14} fill="var(--accent)" stroke="var(--accent)" /> in India
          </span>
        </div>
      </div>
    </footer>
  );
}
