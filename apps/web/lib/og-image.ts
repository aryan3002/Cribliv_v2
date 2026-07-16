/**
 * Choose the OpenGraph/Twitter card image for a listing.
 *
 * Returns the first absolute (http/https) URL in `images` — schema/OG images
 * must be absolute — otherwise the supplied fallback. Relative or blank entries
 * are skipped so a WhatsApp/social share never points at a broken image.
 */
export function ogImageFor(
  images: ReadonlyArray<string | null | undefined> | null | undefined,
  fallback: string
): string {
  const first = (images ?? []).find(
    (url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)
  );
  return first ?? fallback;
}
