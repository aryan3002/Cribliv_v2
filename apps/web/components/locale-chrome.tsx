"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import type { Locale } from "../lib/i18n";
import type { NavData } from "../lib/nav/types";

/* ──────────────────────────────────────────────────────────────────────
 * LocaleChrome
 *
 * Wraps page content with the public site's Header + Footer, EXCEPT on
 * admin and owner routes — these workspaces provide their own route chrome.
 * ──────────────────────────────────────────────────────────────────── */

const NO_CHROME_PATHS = [/\/admin(\/|$)/, /\/owner(\/|$)/];

export function LocaleChrome({
  locale,
  navData,
  children
}: {
  locale: Locale;
  /** Built server-side by app/[locale]/layout.tsx; forwarded, never derived
   *  here — LocaleChrome is a client component and lib/nav/nav-data.ts must
   *  stay out of the browser bundle. Optional so a caller without it still
   *  renders a working (panel-less) header. */
  navData?: NavData;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const skipChrome = pathname && NO_CHROME_PATHS.some((re) => re.test(pathname));

  if (skipChrome) {
    return <>{children}</>;
  }

  return (
    <>
      <Header locale={locale} navData={navData} />
      <main id="main-content" className="page-content">
        {children}
      </main>
      <Footer locale={locale} />
    </>
  );
}
