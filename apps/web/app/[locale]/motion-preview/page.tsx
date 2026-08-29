import type { Metadata } from "next";
import { MotionPreview } from "@/components/motion/MotionPreview";

export const metadata: Metadata = {
  title: "Motion in context — Cribliv",
  description:
    "Before/after preview of TrustMotion on real listing cards and MicroKit on the site's real controls.",
  robots: { index: false, follow: false }
};

// Dev/preview surface — not linked from nav, not indexed.
export default function MotionPreviewPage() {
  return <MotionPreview />;
}
