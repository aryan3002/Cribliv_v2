"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import type { Locale } from "../lib/i18n";

/* ──────────────────────────────────────────────────────────────────────
 * LocaleChrome
 *
 * Wraps page content with the public site's Header + Footer, EXCEPT on
 * admin and owner routes — these workspaces provide their own route chrome.
 * ──────────────────────────────────────────────────────────────────── */

const NO_CHROME_PATHS = [/\/admin(\/|$)/, /\/owner(\/|$)/];

export function LocaleChrome({ locale, children }: { locale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const skipChrome = pathname && NO_CHROME_PATHS.some((re) => re.test(pathname));

  if (skipChrome) {
    return <>{children}</>;
  }

  return (
    <>
      <Header locale={locale} />
      <main id="main-content" className="page-content">
        {children}
      </main>
      <Footer locale={locale} />
    </>
  );
}
