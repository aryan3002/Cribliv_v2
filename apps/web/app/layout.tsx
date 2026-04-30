import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { SessionProvider } from "../components/auth/session-provider";
import { PostHogProvider } from "../components/analytics/posthog-provider";
import { Inter, Manrope, Space_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter"
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-manrope"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  variable: "--font-space-grotesk"
});

// "The Concierge" editorial display serif.
// Used by the listing wizard concierge layout; loaded once globally so
// the rest of the site can opt in via `--font-display` if they want.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono"
});

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0066FF"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} ${spaceGrotesk.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SessionProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
