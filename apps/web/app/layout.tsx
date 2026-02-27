import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SessionProvider } from "../components/auth/session-provider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com"),
  title: {
    default: "Cribliv — Verified Rentals in North India",
    template: "%s | Cribliv"
  },
  description:
    "AI-powered verified rental search. Find flats, PGs, and houses in Delhi, Gurugram, Noida, and more. Owner verification and 12-hour refund guarantee.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Cribliv",
    locale: "en_IN"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
