// Editorial byline for CRIBLIV TIMES — mirrors the API generator's default
// author (blog_posts.author defaults to 'Cribliv Data Desk', migration 0070).
// Used for the byline and the E-E-A-T author bio page. Kept here so both the
// detail page and the author route share one source of truth.
//
// The byline is deliberately the desk, not a persona: the reports are produced
// from Cribliv's live listing data with AI assistance and human review, and
// the byline should say so rather than invent a journalist.

export const EDITORIAL_AUTHOR = {
  name: "Cribliv Data Desk",
  slug: "cribliv-data-desk",
  role: "The data desk of Cribliv Times",
  desk: "Data Desk",
  bio_en:
    "The Cribliv Data Desk turns live listing data into rent reports, locality guides and tenant-rights explainers for renters across India. Every figure is sourced from listings live on Cribliv; reports are produced with AI assistance and reviewed by the Cribliv team before publishing.",
  bio_hi:
    "Cribliv डेटा डेस्क लाइव लिस्टिंग डेटा को किराया रिपोर्ट, इलाके की गाइड और किरायेदार-अधिकार लेखों में बदलता है। हर आँकड़ा Cribliv पर लाइव लिस्टिंग से आता है; रिपोर्ट AI की मदद से बनती हैं और प्रकाशन से पहले Cribliv टीम द्वारा जाँची जाती हैं।"
} as const;

// Bylines stored on posts before the desk rebrand (2026-08). Old rows keep the
// stored value until migration 0070's backfill runs; display always maps.
const LEGACY_AUTHOR_NAMES: readonly string[] = ["Aditi Sharma"];

/** True when a stored byline is the house desk (current or legacy name). */
export function isEditorialAuthor(name: string): boolean {
  return name === EDITORIAL_AUTHOR.name || LEGACY_AUTHOR_NAMES.includes(name);
}

/** Stored byline -> printed byline (legacy persona names become the desk). */
export function displayAuthor(name: string): string {
  return isEditorialAuthor(name) ? EDITORIAL_AUTHOR.name : name;
}

// Typed as Route so `next/link` typedRoutes accepts it at call sites.
export function authorPath(locale: "en" | "hi"): import("next").Route {
  return `/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}` as import("next").Route;
}
