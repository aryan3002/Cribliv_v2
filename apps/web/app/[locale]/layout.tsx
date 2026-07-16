import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { LocaleChrome } from "../../components/locale-chrome";
import { PageviewTracker } from "../../components/analytics/pageview-tracker";
import { WelcomeCreditsModal } from "../../components/welcome-credits-modal";
import { WhatsappFab } from "../../components/whatsapp-fab";
import { isValidLocale, type Locale } from "../../lib/i18n";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return {
    alternates: {
      languages: {
        en: "/en",
        hi: "/hi"
      }
    },
    openGraph: {
      locale: params.locale === "hi" ? "hi_IN" : "en_IN"
    }
  };
}

export default function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!isValidLocale(params.locale)) {
    notFound();
  }

  return (
    <>
      {/* The <html lang> attribute lives in the root layout (outside the
          [locale] segment) and defaults to "en". Correct it to the active
          locale here so /hi pages announce Hindi to assistive tech and
          crawlers. Done via an inline script rather than headers() so pages
          stay statically rendered / ISR. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.lang=${JSON.stringify(params.locale)}`
        }}
      />
      <Suspense fallback={null}>
        <PageviewTracker locale={params.locale} />
      </Suspense>
      <LocaleChrome locale={params.locale as Locale}>{children}</LocaleChrome>
      <WelcomeCreditsModal locale={params.locale as Locale} />
      <WhatsappFab />
    </>
  );
}
