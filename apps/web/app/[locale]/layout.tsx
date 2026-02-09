import type { ReactNode } from "react";
import { Header } from "../../components/header";
import { isValidLocale } from "../../lib/i18n";
import { notFound } from "next/navigation";

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
