import { ALL_INTENTS, getIntent, type IntentDefinition } from "../intent-filters";
import { PG_CITY_CONTENT } from "../pg-city-content";
import { BLOG_DESKS } from "../blog-desks";
import { HUB_CITIES } from "./cities";
import { localityLinks, type NavLink } from "./localities";
import { isPgIntent, translateFilters, type NavSurface } from "./surface-params";

/**
 * Pure, synchronous assembly of the top nav's panel data. No fetch, no React —
 * the header renders in the root layout, and a server fetch there would opt the
 * entire site out of ISR (spec §C1).
 */
export interface NavColumn {
  title: string;
  links: NavLink[];
}

export interface NavPanel {
  id: "rent" | "pg" | "owners" | "times";
  columns: NavColumn[];
}

export type NavLocale = "en" | "hi";

function label(intent: IntentDefinition, locale: NavLocale): string {
  return locale === "hi" ? intent.label_hi : intent.label_en;
}

/** Build a surface URL, always city-scoped, params sorted for stable output. */
function surfaceHref(
  locale: NavLocale,
  surface: NavSurface,
  citySlug: string,
  params: Record<string, string>
): string {
  const path = surface === "pg" ? `/${locale}/pg` : `/${locale}/search`;
  const search = new URLSearchParams({ city: citySlug, ...params });
  return `${path}?${search.toString()}`;
}

function intentLink(
  intent: IntentDefinition,
  locale: NavLocale,
  surface: NavSurface,
  citySlug: string
): NavLink {
  return {
    label: label(intent, locale),
    href: surfaceHref(locale, surface, citySlug, translateFilters(intent.filters, surface))
  };
}

function bySlugs(slugs: string[]): IntentDefinition[] {
  return slugs.map(getIntent).filter((i): i is IntentDefinition => i !== null);
}

function inCategory(category: IntentDefinition["category"]): IntentDefinition[] {
  return ALL_INTENTS.filter((i) => i.category === category);
}

// ── Rent ────────────────────────────────────────────────────────────────────
// Category-derived, then filtered by listing_type so a PG intent can never leak
// in. `rooms` sits in property-type but is listing_type=pg — filtering by slug
// would have missed it and produced /search?listing_type=pg.

export function buildRentPanel(locale: NavLocale, citySlug: string): NavPanel {
  const link = (i: IntentDefinition) => intentLink(i, locale, "search", citySlug);
  const notPg = (i: IntentDefinition) => !isPgIntent(i);

  return {
    id: "rent",
    columns: [
      {
        title: "Property type",
        links: inCategory("property-type").filter(notPg).map(link)
      },
      {
        title: "By budget",
        links: inCategory("budget").filter(notPg).map(link)
      },
      {
        title: "By lifestyle",
        links: [
          ...inCategory("lifestyle").filter(notPg),
          ...bySlugs(["family-flats", "bachelor-flats"])
        ].map(link)
      },
      {
        title: "Popular localities",
        links: localityLinks(locale, citySlug)
      }
    ]
  };
}

// ── PG & Co-living ──────────────────────────────────────────────────────────
// Explicit slug lists rather than category-derived: the PG columns deliberately
// mix categories (audience + lifestyle), and sharing has no intent at all.

const PG_SHARING: ReadonlyArray<{ value: string; en: string; hi: string }> = [
  { value: "single", en: "Single sharing", hi: "सिंगल शेयरिंग" },
  { value: "double", en: "Double sharing", hi: "डबल शेयरिंग" },
  { value: "triple", en: "Triple sharing", hi: "ट्रिपल शेयरिंग" },
  { value: "quad", en: "Four sharing", hi: "चार शेयरिंग" }
];

export function buildPgPanel(locale: NavLocale, citySlug: string): NavPanel {
  const link = (i: IntentDefinition) => intentLink(i, locale, "pg", citySlug);
  const city = PG_CITY_CONTENT[citySlug];

  return {
    id: "pg",
    columns: [
      {
        title: "By sharing",
        links: PG_SHARING.map((s) => ({
          label: locale === "hi" ? s.hi : s.en,
          href: surfaceHref(locale, "pg", citySlug, { sharing: s.value })
        }))
      },
      {
        title: "By who it's for",
        links: bySlugs([
          "pg-for-girls",
          "pg-for-boys",
          "pg-for-students",
          "pg-for-working-professionals"
        ]).map((intent) => {
          // pg-for-students / pg-for-working-professionals carry only
          // listing_type, which the PG surface drops — so their tenant_type is
          // supplied here rather than coming from the intent registry.
          const extra: Record<string, string> =
            intent.slug === "pg-for-students"
              ? { tenant_type: "students" }
              : intent.slug === "pg-for-working-professionals"
                ? { tenant_type: "working" }
                : {};
          return {
            label: label(intent, locale),
            href: surfaceHref(locale, "pg", citySlug, {
              ...translateFilters(intent.filters, "pg"),
              ...extra
            })
          };
        })
      },
      {
        title: "By budget",
        links: inCategory("budget").map(link)
      },
      {
        title: "Food & amenities",
        links: bySlugs(["with-food", "vegetarian-pg", "ac-rooms", "co-living"]).map(link)
      },
      {
        title: "Popular PG hubs",
        links: (city?.hubs ?? []).map((hub) => ({
          label: hub,
          href: surfaceHref(locale, "pg", citySlug, { q: hub })
        }))
      }
    ]
  };
}

// ── For owners ──────────────────────────────────────────────────────────────

export function buildOwnersPanel(locale: NavLocale): NavPanel {
  const hi = locale === "hi";
  const at = (path: string) => `/${locale}${path}`;

  return {
    id: "owners",
    columns: [
      {
        title: hi ? "अपनी प्रॉपर्टी लिस्ट करें" : "List your property",
        links: [
          { label: hi ? "मकान मालिक बनें" : "Become an owner", href: at("/become-owner") },
          { label: hi ? "पीजी ऑपरेटर बनें" : "List your PG", href: at("/pg-operator/become") }
        ]
      },
      {
        title: hi ? "कीमत" : "Pricing",
        links: [{ label: hi ? "प्लान और कीमत" : "Plans and pricing", href: at("/pricing") }]
      },
      {
        title: hi ? "टूल्स" : "Tools",
        links: [{ label: hi ? "रेंट एग्रीमेंट" : "Rent agreement", href: at("/rent-agreement") }]
      },
      {
        title: hi ? "जानें" : "Learn",
        links: [
          { label: hi ? "यह कैसे काम करता है" : "How it works", href: at("/how-it-works") },
          { label: hi ? "सामान्य प्रश्न" : "FAQ", href: at("/faq") }
        ]
      }
    ]
  };
}

// ── Cribliv Times ───────────────────────────────────────────────────────────
// BLOG_DESKS is the shared list (lib/blog-desks.ts, created in Step 3a below).
// Masthead.tsx re-exports it with its slug:null "Front Page" entry prepended —
// that entry is the /blog root, not a category, so it never appears here.

export function buildTimesPanel(locale: NavLocale): NavPanel {
  return {
    id: "times",
    columns: [
      {
        title: locale === "hi" ? "डेस्क" : "Desks",
        links: BLOG_DESKS.map((desk) => ({
          label: locale === "hi" ? desk.hi : desk.en,
          href: `/${locale}/blog/category/${desk.slug}`
        }))
      }
    ]
  };
}

// ── City chip ───────────────────────────────────────────────────────────────

export function cityChipLinks(locale: NavLocale): NavLink[] {
  return HUB_CITIES.map((city) => ({
    label: city.label,
    href: `/${locale}/city/${city.slug}`
  }));
}
