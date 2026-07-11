"use client";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

/**
 * Post-publish confirmation banner. Shown only when the operator lands here
 * straight from the wizard (`?published=1`). Purely presentational.
 */
export default function PgPublishedBanner({ title }: { title: string }) {
  return (
    <motion.div
      className="pgo-glass"
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 20px",
        marginBottom: 24,
        borderLeft: "3px solid #22c55e"
      }}
      role="status"
    >
      <div
        className="pgo-splash__icon-ring pgo-splash__icon-ring--brand"
        style={{ width: 44, height: 44, flexShrink: 0 }}
      >
        <CheckCircle2 size={24} />
      </div>
      <div>
        <h2 className="pgo-heading pgo-heading--sm" style={{ margin: 0 }}>
          {title} is submitted 🎉
        </h2>
        <p className="pgo-desc" style={{ margin: "2px 0 0" }}>
          Submitted for admin review. It goes live once our team approves it. You&apos;ll get
          notified.
        </p>
      </div>
    </motion.div>
  );
}
