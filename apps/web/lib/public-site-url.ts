/**
 * Absolute public-site URLs for admin share actions (copy link / open page).
 *
 * The fallback matches the 33 other NEXT_PUBLIC_SITE_URL call sites — including
 * app/layout.tsx's metadataBase, sitemap.ts, robots.txt, and the PG detail page
 * itself, which derives its own canonical + hreflang from the same base. Keeping
 * one fallback is what guarantees a copied admin link and the target page's
 * <link rel="canonical"> agree.
 *
 * Domain-neutral by design: `admin-home-url.ts` is the older per-surface copy and
 * should converge here when homes is next touched.
 */
export function publicSiteUrl(publicPath: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com").replace(/\/+$/, "");
  const path = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
  return `${siteUrl}${path}`;
}

export async function copyPublicSiteUrl(publicPath: string): Promise<void> {
  const url = publicSiteUrl(publicPath);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }

  if (!copied) throw new Error("copy_failed");
}
