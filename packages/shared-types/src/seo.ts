/**
 * Minimum active listings a programmatic SEO place must have before its page is
 * allowed into the sitemap and permitted to be indexed. Below this the page
 * renders with `robots: noindex, follow` and is excluded from the sitemap.
 *
 * Single source of truth — API (indexable computation) and web (sitemap filter)
 * both import this. It previously existed as four independent copies which
 * silently drifted; do not reintroduce a local constant.
 */
export const INDEXABLE_MIN_LISTINGS = 3;
