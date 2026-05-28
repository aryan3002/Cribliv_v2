# CRIBLIV UI/UX Redesign Plan

## STEP 0 — Project Understanding

### Tech Stack

- **Framework:** Next.js 14.2 (App Router, typed routes)
- **Language:** TypeScript 5.6
- **Styling:** Pure CSS via `globals.css` + CSS custom properties (no Tailwind, no CSS modules)
- **UI Library:** Custom `@cribliv/ui` package (minimal — only tokens + button)
- **Auth:** NextAuth v5 (beta 30) with OTP-based phone auth
- **State Management:** React hooks (useState/useEffect), no Redux/Zustand
- **Router:** Next.js App Router with `[locale]` (en/hi) i18n prefix
- **Monorepo:** pnpm workspaces + Turborepo
- **Testing:** Playwright (e2e), Vitest (API unit)

### Existing Routes (16 pages)

| Route                          | Type                              | Status        |
| ------------------------------ | --------------------------------- | ------------- |
| `/`                            | Redirect to `/en`                 | ✅ Functional |
| `/[locale]`                    | Home — hero search, city grid     | ✅ Basic      |
| `/[locale]/search`             | Search results — server-side list | ✅ Basic      |
| `/[locale]/listing/[id]`       | Listing detail — unlock flow      | ✅ Functional |
| `/[locale]/shortlist`          | Shortlist (guest + auth)          | ✅ Functional |
| `/[locale]/city/[slug]`        | City landing page                 | ⚠️ Skeleton   |
| `/[locale]/become-owner`       | Role upgrade request              | ✅ Functional |
| `/[locale]/owner/dashboard`    | Owner listing management          | ✅ Functional |
| `/[locale]/owner/listings/new` | Create listing wizard             | ✅ Functional |
| `/[locale]/owner/verification` | Verification flow                 | ✅ Functional |
| `/[locale]/pg/onboarding`      | PG onboarding                     | ⚠️ Skeleton   |
| `/[locale]/tenant/dashboard`   | Tenant account page               | ✅ Basic      |
| `/[locale]/admin`              | Admin dashboard (tabs)            | ✅ Functional |
| `/auth/login`                  | OTP login/signup                  | ✅ Functional |
| `/auth/error`                  | Auth error page                   | ✅ Functional |
| `/403`                         | Access denied                     | ✅ Functional |

### UI Inventory — Current Pain Points

1. **No Tailwind** — All styling is in one 1000+ line globals.css, hard to maintain
2. **No component library** — Inline styles everywhere (listing detail, dashboards, auth pages)
3. **No responsive system** — Single `@media (max-width: 700px)` breakpoint
4. **No map experience** — Search is a basic server-rendered list with no map
5. **No image handling** — No gallery, no image optimization, no placeholders
6. **No skeleton/loading states** on most pages
7. **Inconsistent typography** — Mix of Raleway, Manrope, Montserrat without clear hierarchy
8. **No design tokens in CSS** — Spacing/sizing/shadows not tokenized
9. **Flat visual design** — No elevation, no depth, no visual hierarchy beyond color
10. **Header hides nav on mobile** — No hamburger/bottom nav replacement

### Previous CRIBLIV Brand Essence

- **Primary Blue:** `#0175FE` (strong, trust-inducing)
- **Fonts:** Manrope (body), Raleway (headings), Montserrat (accent)
- **Trust Green:** `#138A36`
- **Light, airy surface:** `#F5F5F7` background
- **Sticky glass-blur header** with text-only "Cribliv" logo
- **Verification-first messaging** — trust strip, verified badges

---

## STEP 1 — Benchmark Research

### A) Global IA Patterns

| Platform      | Nav Model                           | Search Entry                                           | Account Area                            |
| ------------- | ----------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Zillow        | Mega nav — Buy/Rent/Sell/Home Loans | Persistent search bar in header, location autocomplete | Saved homes, saved searches, profile    |
| Redfin        | Clean top nav, search is the focus  | Full-width hero search → sticky in-page search         | Dashboard with tours, favorites         |
| Rightmove     | Minimal header, purpose-driven      | Big hero → "Find properties for sale or rent"          | Saved properties, email alerts          |
| Domain.com.au | Tab nav (Buy/Rent/Sold/New)         | Hero search with tabs                                  | My Domain (shortlist, searches, alerts) |

**Key insight:** All top platforms make search THE primary action. Navigation is minimal. Account/saved items are secondary but always accessible.

### B) Search Results UX

- **Split view (Zillow/Redfin):** Map on right (desktop), list on left. Map is sticky.
- **Clustering:** Map markers cluster at low zoom, individual pins at high zoom.
- **Sticky filters:** Horizontal filter bar that sticks on scroll (price, beds, type, more).
- **Sort:** Relevance, price ↑↓, newest. Clean dropdown.
- **Save search:** Bell icon or "Save this search" CTA after filtering.
- **Hover sync:** Hovering a card highlights the map pin and vice versa (Zillow, Redfin).
- **Infinite scroll + pagination:** Redfin uses load-more, Zillow infinite scroll.
- **Mobile:** Full-screen map toggle button, bottom sheet for list, bottom sheet for filters.

### C) Listing Detail UX

- **Hero gallery:** Full-width image carousel with lightbox. 1 large + grid of 4 thumbnails (Zillow pattern).
- **Key facts strip:** Beds, baths, sqft, price — above fold, high contrast.
- **Map + neighborhood:** Small map with nearby schools, transit, walkability scores.
- **Price history / comparables:** Timeline chart (Zillow), or "similar homes nearby."
- **CTA panel:** Sticky sidebar (desktop) or sticky bottom bar (mobile) — "Contact Agent", "Schedule Tour."
- **Trust signals:** Agent info, response time, verified badge, refund guarantees.

### D) Trust Signals UX

- Verification badges (green checkmark + "Verified Listing")
- Agent photo + name + response rate
- "No response → refund" guarantee badges
- Secure lock icon near contact info
- User reviews / ratings where available

### E) Microinteractions

- Skeleton loading (Zillow-style shimmer cards)
- Heart icon toggle for shortlist (with instant optimistic UI)
- Toast notifications ("Added to shortlist", "Search saved")
- Smooth page transitions
- Hover elevation on cards
- Filter chips animate in/out

### F) Mobile Patterns

- Bottom navigation bar (Zillow app: Search, Saved, Updates, Account)
- Bottom sheet for filters (full height, swipe to dismiss)
- Map/list toggle as floating button
- Swipe gestures on gallery
- Pull-to-refresh on search results

### G) Accessibility + Performance

- Semantic HTML (main, nav, article, section)
- Skip links, ARIA labels on interactive elements
- Focus rings on all interactive elements
- Color contrast ≥ 4.5:1 for body text
- Lazy loading images with `next/image`
- Preconnect to font CDNs
- Minimal JavaScript — SSR where possible
- No layout shifts (explicit image dimensions)

---

## STEP 2 — Design Direction

### Direction A: "Modern Minimal Luxury"

- Clean white space, subtle gradients, premium card depth
- Monochrome base with brand blue as the only accent
- **Pros:** Premium, timeless, fast to implement
- **Cons:** Could feel generic without careful art direction

### Direction B: "Neo-Editorial"

- Magazine-style typography, strong grid layouts, editorial photography
- **Pros:** Distinctive, high-end feel
- **Cons:** Needs more content/photography investment, harder to maintain

### Direction C: "Crisp Product-Led" ← **CHOSEN**

- Product-first approach: every pixel earns its place
- Clean, fast, information-dense but never cluttered
- Subtle warmth through rounded corners, gentle shadows, and micro-animations
- Brand blue stays prominent but paired with a warm neutral palette
- Trust signals are integrated naturally, not bolted on
- **Pros:** Best balance — premium but approachable, fast, maintainable, scales well
- **Cons:** Requires discipline to not over-engineer

### Design System: "Crisp Product-Led"

#### Color Tokens

```
--brand: #0066FF          (evolved from #0175FE — slightly deeper, more modern)
--brand-light: #E8F0FF    (tinted surfaces)
--brand-dark: #0052CC     (hover/active states)
--trust: #0D9F4F          (verification, success — slightly brighter)
--warning: #E88C00         (amber warnings)
--danger: #DC2626          (errors, critical)
--surface: #FFFFFF
--surface-raised: #FAFBFC  (card surfaces)
--surface-sunken: #F3F4F6  (page backgrounds)
--text-primary: #111827    (near-black, high contrast)
--text-secondary: #4B5563  (muted text)
--text-tertiary: #9CA3AF   (placeholders)
--border: #E5E7EB          (subtle borders)
--border-strong: #D1D5DB   (input borders)
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05)
--shadow-md: 0 4px 12px rgba(0,0,0,0.08)
--shadow-lg: 0 12px 40px rgba(0,0,0,0.12)
--shadow-xl: 0 24px 48px rgba(0,0,0,0.16)
```

#### Typography System (using Inter as primary — clean, modern, excellent readability)

We keep Manrope for headings (CRIBLIV identity), use Inter for body.

```
--font-heading: 'Manrope', sans-serif     (keeping CRIBLIV essence)
--font-body: 'Inter', sans-serif           (clean, professional body)
--font-mono: 'JetBrains Mono', monospace

Display:     48/52 — Manrope 700
H1:          36/40 — Manrope 700
H2:          28/32 — Manrope 600
H3:          22/28 — Manrope 600
H4:          18/24 — Manrope 600
Body Large:  18/28 — Inter 400
Body:        15/24 — Inter 400
Body Small:  13/20 — Inter 400
Caption:     12/16 — Inter 500
Overline:    11/16 — Inter 600, uppercase, letter-spacing 0.05em
```

#### Spacing (8pt grid)

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
--space-20: 80px
--space-24: 96px
```

#### Border Radius

```
--radius-sm: 6px
--radius-md: 10px
--radius-lg: 16px
--radius-xl: 24px
--radius-full: 9999px
```

#### Breakpoints (mobile-first)

```
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1440px
```

#### Component Style Rules

- **Cards:** White background, `--shadow-sm` resting, `--shadow-md` on hover, `--radius-lg`, 1px border
- **Buttons Primary:** `--brand` bg, white text, `--radius-md`, 44px min height, 600 weight
- **Buttons Secondary:** White bg, `--border` border, `--text-primary`, hover bg `--surface-sunken`
- **Buttons Ghost:** No bg/border, `--brand` text, hover: brand-light bg
- **Inputs:** 44px height, `--border-strong` border, `--radius-md`, focus: brand ring
- **Chips/Tags:** Pill shape, 28px height, `--surface-sunken` bg, `--text-secondary`
- **Badges:** Inline, small, semantic colors (green verified, amber pending, red failed)

#### CRIBLIV Essence Preserved

- ✅ Brand blue primary color (evolved but recognizable)
- ✅ Manrope heading font (signature of CRIBLIV)
- ✅ Trust strip / verification badges
- ✅ Sticky glass-blur header
- ✅ "Cribliv" text logo with consistent weight
- ✅ Search-first homepage hero
- ✅ Hindi/English toggle

---

## STEP 3 — Information Architecture

### Sitemap / Route Plan

```
/                           → Redirect to /en
/[locale]                   → Home (hero search, categories, featured, trust)
/[locale]/search            → Search results (map+list split)
/[locale]/listing/[id]      → Listing detail
/[locale]/city/[slug]       → City landing
/[locale]/shortlist         → Saved listings
/[locale]/saved-searches    → Saved searches (new)
/[locale]/become-owner      → Role upgrade
/[locale]/owner/dashboard   → Owner dashboard
/[locale]/owner/listings/new → Create listing
/[locale]/owner/verification → Verification flow
/[locale]/pg/onboarding     → PG onboarding
/[locale]/tenant/dashboard  → Tenant settings
/[locale]/admin             → Admin panel
/auth/login                 → Login/signup
/auth/error                 → Auth error
/403                        → Access denied
```

### Key Page Layouts

#### Home / Landing

```
┌─────────────────────────────────────────────────┐
│ NAVBAR [Logo] [Search] [Shortlist] [Login/User] │
├─────────────────────────────────────────────────┤
│                                                 │
│  HERO SECTION                                   │
│  "Find your perfect home"                       │
│  [🔍 Search bar ──────────── 🎤 ] [Search]     │
│  [Delhi] [Gurugram] [Noida] [More] ← city chips│
│                                                 │
├─────────────────────────────────────────────────┤
│  TRUST STRIP                                    │
│  ✓ Verified  |  ⚡ 12h Refund  |  🔒 Secure    │
├─────────────────────────────────────────────────┤
│  FEATURED CATEGORIES                            │
│  [🏠 Flats] [🏘 PG] [🏡 Houses] [⭐ Premium]   │
├─────────────────────────────────────────────────┤
│  FEATURED LISTINGS                              │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│  │Card│ │Card│ │Card│ │Card│  ← horizontal scroll│
│  └────┘ └────┘ └────┘ └────┘                   │
├─────────────────────────────────────────────────┤
│  TOP CITIES                                     │
│  [Delhi] [Gurugram] [Noida] [Jaipur]...        │
├─────────────────────────────────────────────────┤
│  HOW IT WORKS                                   │
│  1. Search → 2. Verify → 3. Connect            │
├─────────────────────────────────────────────────┤
│  FOOTER                                         │
└─────────────────────────────────────────────────┘
```

#### Search Results (Desktop: Map + List Split)

```
┌──────────────────────────────────────────────────┐
│ NAVBAR (compact, search bar integrated)          │
├──────────────────────────────────────────────────┤
│ FILTER BAR (sticky)                              │
│ [Type ▾] [Price ▾] [Beds ▾] [Verified ▾] [Sort]│
├────────────────────────┬─────────────────────────┤
│  LISTING LIST          │  MAP                    │
│  ┌──────────────────┐  │  ┌───────────────────┐  │
│  │ Card             │  │  │                   │  │
│  └──────────────────┘  │  │    [pin] [pin]    │  │
│  ┌──────────────────┐  │  │         [pin]     │  │
│  │ Card             │  │  │                   │  │
│  └──────────────────┘  │  │                   │  │
│  ┌──────────────────┐  │  │                   │  │
│  │ Card             │  │  └───────────────────┘  │
│  └──────────────────┘  │                         │
│  Load more...          │                         │
└────────────────────────┴─────────────────────────┘
```

#### Listing Detail

```
┌───────────────────────────────────────────────────┐
│ NAVBAR (with back nav)                            │
├───────────────────────────────────────────────────┤
│ GALLERY                                           │
│ ┌───────────────────────┬──────┬──────┐           │
│ │                       │  img │  img │           │
│ │    Main Image         ├──────┼──────┤           │
│ │                       │  img │  img │ [See all] │
│ └───────────────────────┴──────┴──────┘           │
├───────────────────────────────┬───────────────────┤
│  LEFT CONTENT                 │ RIGHT SIDEBAR     │
│  Title + Location             │ ┌───────────────┐ │
│  ₹XX,XXX/month               │ │ CONTACT CARD  │ │
│                               │ │ [Unlock]      │ │
│  KEY FACTS                    │ │ Phone/WA      │ │
│  🛏 2BHK  📐 950sqft  🏢 3rd│ │ Response time │ │
│                               │ └───────────────┘ │
│  DESCRIPTION                  │ ┌───────────────┐ │
│  Full listing text...         │ │ TRUST CARD    │ │
│                               │ │ ✓ Verified    │ │
│  AMENITIES                    │ │ 🛡 Refund     │ │
│  [WiFi] [AC] [Parking]       │ └───────────────┘ │
│                               │                   │
│  MAP                          │                   │
│  ┌─────────────────────────┐  │                   │
│  │     Neighborhood map     │  │                   │
│  └─────────────────────────┘  │                   │
│                               │                   │
│  SIMILAR LISTINGS             │                   │
│  ┌────┐ ┌────┐ ┌────┐       │                   │
│  │Card│ │Card│ │Card│       │                   │
│  └────┘ └────┘ └────┘       │                   │
└───────────────────────────────┴───────────────────┘
```

---

## STEP 4 — Implementation Plan

### Phase 1: Foundation (Design System)

1. Replace `globals.css` with a modern CSS custom properties system
2. Add Google Fonts import (Inter + Manrope)
3. Create utility classes for spacing, typography, layout
4. Create CSS component classes (buttons, cards, inputs, badges, chips, skeletons)

### Phase 2: Core Components

1. `Navbar` — responsive, glass-blur, mobile hamburger
2. `SearchBar` — autocomplete-ready, voice button integrated
3. `FilterBar` — horizontal sticky filter chips
4. `ListingCard` — image, title, price, badges, shortlist heart
5. `Gallery` — image grid with lightbox
6. `StatsRow` — key facts horizontal display
7. `CTAPanel` — sticky contact/unlock panel
8. `Footer` — site links, trust badges
9. `Modal/Drawer` — accessible overlay system
10. `Toast` — notification system
11. `Skeleton` — loading placeholders for every component

### Phase 3: Page Implementation

1. Home / Landing page
2. Search Results (with map placeholder + filter bar)
3. Listing Detail (gallery + contact + similar)
4. Auth pages (login/signup with modern UI)
5. Shortlist + Saved searches
6. Tenant settings
7. Error/empty/loading states everywhere

### Phase 4: Polish

1. Micro-interactions (hover, transitions)
2. Mobile bottom nav
3. Accessibility audit (focus, contrast, semantics)
4. Performance audit (image optimization, bundle)

---

## QA Checklist

### Responsive

- [ ] All pages tested at 375px (iPhone SE)
- [ ] All pages tested at 768px (iPad)
- [ ] All pages tested at 1280px (Desktop)
- [ ] All pages tested at 1440px+ (Wide desktop)
- [ ] No horizontal overflow at any breakpoint

### Accessibility

- [ ] All interactive elements are keyboard accessible
- [ ] Focus rings visible on all focusable elements
- [ ] Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text
- [ ] All images have alt text
- [ ] ARIA labels on icon-only buttons
- [ ] Skip-to-content link
- [ ] Semantic HTML (nav, main, article, section)
- [ ] Form inputs have associated labels

### Performance

- [ ] No layout shifts (CLS < 0.1)
- [ ] Images use next/image or explicit dimensions
- [ ] Fonts preloaded
- [ ] No heavy JS libraries added unnecessarily
- [ ] SSR for all public pages
- [ ] Loading skeletons prevent flash of empty content

### Functional

- [ ] Search form submits and navigates to results
- [ ] Listing detail loads and shows all data
- [ ] Auth flow works (or gracefully shows error)
- [ ] Shortlist add/remove works
- [ ] Voice search button shows proper states
- [ ] City pages render correctly
- [ ] Role-based nav links show/hide correctly
- [ ] Hindi locale toggle works
- [ ] 403 / error pages display correctly

---

## Developer Notes (Backend Dependencies)

### Required Environment Variables

```
NEXT_PUBLIC_API_BASE_URL    — Backend API (default: http://localhost:4000/v1)
NEXT_PUBLIC_SITE_URL        — Public URL (default: https://cribliv.com)
AUTH_SECRET                 — NextAuth secret
```

### API Endpoints the UI Expects

- `GET /listings/search?q=&city=&...` — Search listings
- `GET /listings/:id` — Listing detail
- `POST /search/agentic-route` — AI-powered search routing
- `POST /search/voice` — Voice search (multipart/form-data)
- `POST /auth/otp/send` — Request OTP
- `POST /auth/otp/verify` — Verify OTP
- `GET /shortlist` — User's shortlist
- `DELETE /shortlist/:id` — Remove from shortlist
- `POST /listings/:id/unlock` — Unlock owner contact
- `GET /wallet/balance` — Wallet credits

### If Backend Is Down

All pages implement graceful error states. Search shows "API unavailable" message.
Auth shows error messaging with retry. Listing detail shows "unavailable" panel.
Voice search shows microphone permission/browser support errors gracefully.
