import Link from "next/link";
import type { Locale } from "../lib/i18n";

export function Header({ locale }: { locale: Locale }) {
  return (
    <header className="header">
      <div className="container nav-row">
        <Link href={`/${locale}`} className="logo">
          <img src="/cribliv.svg" alt="Cribliv" />
          <span>Cribliv</span>
        </Link>
        <nav className="nav-links">
          <Link href={`/${locale}/search?city=noida`}>Search</Link>
          <Link href={`/${locale}/shortlist`}>Shortlist</Link>
          <Link href={`/${locale}/owner/dashboard`}>Post Property</Link>
          <Link href={`/${locale}/admin`}>Admin</Link>
        </nav>
        <div className="lang-switch">
          <Link href={`/en`} prefetch={false}>
            EN
          </Link>
          <span>|</span>
          <Link href={`/hi`} prefetch={false}>
            हिंदी
          </Link>
        </div>
      </div>
    </header>
  );
}
