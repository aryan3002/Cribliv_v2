import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { color, radius, space, typography } from "../tokens";

type Variant = "primary" | "secondary" | "tertiary";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/**
 * Cribliv primary actions use the coral accent (one per screen); secondary
 * actions use brand blue. Styled from canonical tokens so it stays on-brand
 * wherever it renders. The web app does not use Tailwind, so styling is inline
 * via tokens rather than utility classes.
 */
const variantStyles: Record<Variant, CSSProperties> = {
  primary: {
    background: color.accent,
    color: color.textInverse,
    border: `1px solid ${color.accent}`
  },
  secondary: {
    background: color.surface,
    color: color.brand,
    border: `1px solid ${color.brand}`
  },
  tertiary: {
    background: "transparent",
    color: color.brand,
    border: "1px solid transparent"
  }
};

export function Button({ variant = "primary", children, style, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      style={{
        height: 44,
        paddingInline: space.s4,
        borderRadius: radius.md,
        fontFamily: typography.fontBody,
        fontSize: typography.scale.small,
        fontWeight: typography.weight.semibold,
        cursor: "pointer",
        ...variantStyles[variant],
        ...style
      }}
    >
      {children}
    </button>
  );
}
