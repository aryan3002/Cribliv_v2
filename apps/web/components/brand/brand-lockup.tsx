import Image from "next/image";

type Size = "sm" | "md" | "lg";

interface Props {
  size?: Size;
  glow?: boolean;
  priority?: boolean;
  className?: string;
}

/**
 * Cribliv brand lockup: house-shape icon + "CribLiv" wordmark.
 * Sizing is controlled entirely by CSS (height-based, width auto) so the source
 * PNGs render at their natural aspect ratio — exactly like the legacy header markup.
 *
 * Variants:
 * - "md" (default) → matches the global header (icon 25h, wordmark 22h)
 * - "sm"           → compact (icon 20h, wordmark 18h)
 * - "lg"           → auth/marketing moments (icon 44h, wordmark 38h)
 */
export function BrandLockup({ size = "md", glow = false, priority = false, className }: Props) {
  return (
    <span
      className={`brand-lockup brand-lockup--${size}${glow ? " brand-lockup--glow" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Cribliv"
    >
      {/* width/height props are required by next/image but CSS overrides them.
          We pass the natural aspect (28×25 for the icon, 72×24 for the wordmark)
          so the layout reservation is correct before CSS applies. */}
      <Image
        src="/cribliv.png"
        alt=""
        width={28}
        height={25}
        priority={priority}
        className="logo-img"
      />
      <Image
        src="/criblivFont.png"
        alt="Cribliv"
        width={72}
        height={24}
        priority={priority}
        className="logo-font"
      />
    </span>
  );
}
