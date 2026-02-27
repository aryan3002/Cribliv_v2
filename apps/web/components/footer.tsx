import Link from "next/link";
import type { Locale } from "../lib/i18n";

export function Footer({ locale }: { locale: Locale }) {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          {/* Brand column */}
          <div>
            <div className="footer__brand">
              <span
                className="logo-dot"
                style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }}
                aria-hidden="true"
              />
              Cribliv
            </div>
            <p className="footer__description">
              AI-powered verified rental search for North India. Find flats, PGs, and houses with
              owner verification and a 12-hour refund guarantee.
            </p>
          </div>

          {/* Explore */}
          <div>
            <h4 className="footer__heading">Explore</h4>
            <div className="footer__links">
              <Link href={`/${locale}/search?city=noida`} className="footer__link">
                Search Rentals
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
              <Link href={`/${locale}/city/ghaziabad`} className="footer__link">
                Ghaziabad
              </Link>
            </div>
          </div>

          {/* For Owners */}
          <div>
            <h4 className="footer__heading">For Owners</h4>
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
            <h4 className="footer__heading">Support</h4>
            <div className="footer__links">
              <span className="footer__link">help@cribliv.com</span>
              <span className="footer__link">Privacy Policy</span>
              <span className="footer__link">Terms of Service</span>
            </div>
          </div>
        </div>

        <hr className="footer__divider" />

        <div className="footer__bottom">
          <span>&copy; {year} Cribliv. All rights reserved.</span>
          <span>Made with care in India 🇮🇳</span>
        </div>
      </div>
    </footer>
  );
}
