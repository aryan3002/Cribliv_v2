import Image from "next/image";

type Size = "sm" | "md" | "lg";

const BRAND_MARK_SRC = "/cribliv-logo-new.svg";
const BRAND_WORDMARK_SRC = "/criblivFont.png";
/** Same wordmark geometry, white ink — for dark canvases (footer, dark chrome). */
const BRAND_WORDMARK_LIGHT_SRC = "/criblivFont-light.png";

interface Props {
  size?: Size;
  glow?: boolean;
  priority?: boolean;
  className?: string;
  /**
   * Render the wordmark in white for placement on a dark surface. The mark
   * itself is a blue house that already reads on dark, so it is unchanged.
   */
  onDark?: boolean;
}

/**
 * Cribliv brand lockup: brand mark + "CribLiv" wordmark.
 * Sizing is controlled entirely by CSS (height-based, width auto) so the source
 * PNGs render at their natural aspect ratio — exactly like the legacy header markup.
 *
 * Variants:
 * - "md" (default) → matches the global header (icon 25h, wordmark 22h)
 * - "sm"           → compact (icon 20h, wordmark 18h)
 * - "lg"           → auth/marketing moments (icon 44h, wordmark 38h)
 */
export function BrandLockup({
  size = "md",
  glow = false,
  priority = false,
  className,
  onDark = false
}: Props) {
  return (
    <span
      className={`brand-lockup brand-lockup--${size}${glow ? " brand-lockup--glow" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Cribliv"
    >
      {/* width/height props are required by next/image but CSS overrides them.
          We pass the natural aspect (1:1 for the icon, ~4:1 for the wordmark,
          tightly cropped to its glyphs) so the layout reservation is correct
          before CSS applies. */}
      <Image
        src={BRAND_MARK_SRC}
        alt=""
        width={28}
        height={28}
        priority={priority}
        className="logo-img"
      />
      <Image
        src={onDark ? BRAND_WORDMARK_LIGHT_SRC : BRAND_WORDMARK_SRC}
        alt="Cribliv"
        width={96}
        height={24}
        priority={priority}
        className="logo-font"
      />
    </span>
  );
}
