// Editorial byline for CRIBLIV TIMES — mirrors the API generator's default
// author (blog_posts.author defaults to 'Aditi Sharma'). Used for the byline
// and the E-E-A-T author bio page. Kept here so both the detail page and the
// author route share one source of truth.

export const EDITORIAL_AUTHOR = {
  name: "Aditi Sharma",
  slug: "aditi-sharma",
  role: "Rental Markets Editor, Cribliv",
  desk: "Data Desk",
  bio_en:
    "Aditi Sharma covers India's rental markets for Cribliv, turning live listing data into practical guidance for tenants. She has tracked rents across Lucknow and the NCR since 2023.",
  bio_hi:
    "अदिति शर्मा Cribliv के लिए भारत के किराया बाज़ार पर लिखती हैं और लाइव लिस्टिंग डेटा को किरायेदारों के लिए व्यावहारिक सलाह में बदलती हैं। वे 2023 से लखनऊ और एनसीआर में किराये पर नज़र रख रही हैं।"
} as const;

// Typed as Route so `next/link` typedRoutes accepts it at call sites.
export function authorPath(locale: "en" | "hi"): import("next").Route {
  return `/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}` as import("next").Route;
}
