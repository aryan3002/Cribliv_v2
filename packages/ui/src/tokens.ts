/**
 * Cribliv Design Tokens — single canonical source of truth.
 *
 * Extracted verbatim from the live web design system
 * (apps/web/app/globals.css, "CRIBLIV Design System v2.0"). This is the brand
 * contract: every surface — web today, the design system synced into Claude
 * Design, and the future mobile app — should read from here rather than
 * redefining values inline.
 *
 * NOTE: This previously held a smaller, drifting copy of the tokens (e.g.
 * trust #16A34A, text #0F172A) that disagreed with the live web values. Those
 * are corrected here. Legacy named exports (`colorTokens`, `spacingTokens`, …)
 * are preserved at the bottom for backward compatibility.
 */

export const color = {
  // Brand
  brand: "#0066FF",
  brandLight: "#EBF3FF",
  brandDark: "#0052CC",
  brand50: "#EFF6FF",
  brand100: "#DBEAFE",
  brand600: "#2563EB",
  brand700: "#1D4ED8",
  brand800: "#1E40AF",

  // Accent (warm coral) — reserve for ONE primary action per screen
  accent: "#FF5A5F",
  accentLight: "#FFF1F0",
  accentDark: "#E04848",
  amber: "#F59E0B",
  amberLight: "#FFFBEB",

  // Semantic
  trust: "#0D9F4F",
  trustLight: "#ECFDF5",
  trustDark: "#065F46",
  warning: "#E88C00",
  warningLight: "#FFF8E1",
  danger: "#DC2626",
  dangerLight: "#FEF2F2",

  // Surfaces
  surface: "#FFFFFF",
  surfaceRaised: "#FAFBFC",
  surfaceSunken: "#F5F5F7",
  surfaceOverlay: "rgba(0, 0, 0, 0.5)",

  // Text
  textPrimary: "#1A1A2E",
  textSecondary: "#64748B",
  textTertiary: "#6B7280",
  textInverse: "#FFFFFF",
  textBrand: "#0066FF",
  textTrust: "#0D9F4F",
  textDanger: "#DC2626",

  // Borders
  border: "#E8ECF1",
  borderStrong: "#CBD5E1",
  borderFocus: "#0066FF"
} as const;

export const shadow = {
  xs: "0 1px 2px rgba(0,0,0,0.05)",
  sm: "0 1px 3px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)",
  md: "0 4px 12px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
  lg: "0 8px 24px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04)",
  xl: "0 16px 48px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
  brand: "0 4px 14px rgba(0, 102, 255, 0.3)",
  card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  cardHover: "0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.04)"
} as const;

export const typography = {
  fontHeading: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // Type scale (px) — editorial, large display headings
  scale: {
    display: 48,
    h1: 36,
    h2: 28,
    h3: 22,
    h4: 18,
    body: 16,
    small: 14,
    caption: 12
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800
  }
} as const;

/** 8pt spacing grid (px). */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
  s10: 40,
  s12: 48,
  s16: 64,
  s20: 80,
  s24: 96
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  full: 9999
} as const;

export const transition = {
  fast: "150ms ease",
  base: "250ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "400ms cubic-bezier(0.4, 0, 0.2, 1)",
  spring: "500ms cubic-bezier(0.34, 1.56, 0.64, 1)"
} as const;

export const layout = {
  containerMax: 1280,
  containerNarrow: 720,
  headerHeight: 72,
  sidebarWidth: 380
} as const;

/** The whole system as one object — convenient for design-sync / theming. */
export const tokens = {
  color,
  shadow,
  typography,
  space,
  radius,
  transition,
  layout
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy aliases — kept so any older import keeps compiling. Prefer the named
// groups above (`color`, `space`, …) in new code.
// ─────────────────────────────────────────────────────────────────────────────
export const colorTokens = {
  brand: color.brand,
  brandDark: color.brandDark,
  brandLight: color.brandLight,
  trust: color.trust,
  warning: color.warning,
  danger: color.danger,
  surface: color.surface,
  surfaceAlt: color.surfaceSunken,
  surfaceRaised: color.surfaceRaised,
  text: color.textPrimary,
  textSecondary: color.textSecondary,
  textTertiary: color.textTertiary,
  muted: color.textSecondary,
  border: color.border
};

export const spacingTokens = {
  s1: space.s1,
  s2: space.s2,
  s3: space.s3,
  s4: space.s4,
  s5: space.s6,
  s6: space.s8,
  s7: space.s12,
  s8: space.s16
};

export const radiusTokens = {
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: radius.xl,
  pill: radius.full
};

export const typographyTokens = {
  body: typography.fontBody,
  heading: typography.fontHeading
};
