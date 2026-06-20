import type { CSSProperties, ReactNode } from "react";
import { color, radius, space, typography } from "../tokens";

export type BadgeTone = "verified" | "pending" | "brand" | "neutral" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Trust signals are core to the Cribliv brand — "Verified", "Pending",
 * refund guarantees. This pill renders them consistently from canonical tokens.
 */
const toneStyles: Record<BadgeTone, CSSProperties> = {
  verified: { background: color.trustLight, color: color.trustDark },
  pending: { background: color.warningLight, color: color.warning },
  brand: { background: color.brandLight, color: color.brandDark },
  neutral: { background: color.surfaceSunken, color: color.textSecondary },
  danger: { background: color.dangerLight, color: color.danger }
};

export function Badge({ tone = "neutral", children, style }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.s1,
        paddingInline: space.s3,
        paddingBlock: space.s1,
        borderRadius: radius.full,
        fontFamily: typography.fontBody,
        fontSize: typography.scale.caption,
        fontWeight: typography.weight.semibold,
        lineHeight: 1.4,
        ...toneStyles[tone],
        ...style
      }}
    >
      {children}
    </span>
  );
}
