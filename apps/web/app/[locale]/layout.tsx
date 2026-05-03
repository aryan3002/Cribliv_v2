import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { LocaleChrome } from "../../components/locale-chrome";
import { PageviewTracker } from "../../components/analytics/pageview-tracker";
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
      <Suspense fallback={null}>
        <PageviewTracker locale={params.locale} />
      </Suspense>
      <LocaleChrome locale={params.locale as Locale}>{children}</LocaleChrome>
    </>
  );
}
