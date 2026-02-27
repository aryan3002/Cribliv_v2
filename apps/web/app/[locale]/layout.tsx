import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Header } from "../../components/header";
import { isValidLocale } from "../../lib/i18n";
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
      <Header locale={params.locale} />
      <main className="container">{children}</main>
    </>
  );
}
