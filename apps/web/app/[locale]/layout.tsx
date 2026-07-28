import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { LocaleChrome } from "../../components/locale-chrome";
import { PageviewTracker } from "../../components/analytics/pageview-tracker";
import { WelcomeCreditsModal } from "../../components/welcome-credits-modal";
import { NamePromptProvider } from "../../components/name-capture/name-prompt-provider";
import { ToastProvider } from "../../components/ui/toast/toast-provider";
import { WhatsappFab } from "../../components/whatsapp-fab";
import { isValidLocale, type Locale } from "../../lib/i18n";
import { buildNavData } from "../../lib/nav/nav-data";
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

  // The header's mega-menu panels are built here, in the only Server Component
  // in the chrome's render tree. buildNavData is pure and synchronous — no
  // fetch, no headers() — so this layout stays statically renderable, and the
  // ~46 KB of city prose behind lib/nav/nav-model.ts never reaches the client
  // bundle. It crosses to the client header as plain serializable data.
  const navData = buildNavData(params.locale);

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
      <ToastProvider>
        <NamePromptProvider locale={params.locale as Locale}>
          <LocaleChrome locale={params.locale as Locale} navData={navData}>
            {children}
          </LocaleChrome>
        </NamePromptProvider>
        <WelcomeCreditsModal locale={params.locale as Locale} />
        <WhatsappFab />
      </ToastProvider>
    </>
  );
}
