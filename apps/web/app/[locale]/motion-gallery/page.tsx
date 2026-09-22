import type { Metadata } from "next";
import { MotionGallery } from "@/components/motion/MotionGallery";

export const metadata: Metadata = {
  title: "Motion Kit — Cribliv",
  description:
    "Live in-repo gallery of the Cribliv motion system: Maya's orb, the listening hero, the trust kit, MicroKit and the search→map→listing journey.",
  robots: { index: false, follow: false }
};

// Dev/preview surface — not linked from nav, not indexed.
export default function MotionGalleryPage({ params }: { params: { locale: string } }) {
  const locale = params.locale === "hi" ? "hi" : "en";
  return <MotionGallery locale={locale} />;
}
