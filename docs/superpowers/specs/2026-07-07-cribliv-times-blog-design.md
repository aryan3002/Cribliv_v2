# CRIBLIV TIMES — Blog Visual Design Spec (Slice 3, web layer)

- **Date:** 2026-07-07
- **Status:** Design (for review) → drives Slice 3 web Tasks 20–24
- **Depends on:** Slice 3 engine (Tasks 1–19 — `BlogService`, blog types, web blog API client + `buildArticle` JSON-LD + author data). Engine is design-independent and built separately (Codex).
- **Concept mock:** https://claude.ai/code/artifact/92838bcc-39ea-4105-8772-52e7bf5256d7 (front page + article view)

---

## 1. Thesis

Cribliv's blog is a **rental-market data desk**, not a generic company blog. It reports rents, neighbourhoods, and tenancy with bylines, datelines, and sourced data graphics. The newspaper form is chosen because it does three jobs at once:

1. **Fits the content** — the engine generates data-grounded posts (rent indices, market reports, guides); a data-desk voice makes that authority feel native.
2. **Is the E-E-A-T play** — bylines, named authors, datelines, sections, "updated on" are exactly Google's experience/authority signals, and map 1:1 onto the engine's `author` field + author pages (Task 22).
3. **Carries a native monetization bridge** — newspapers always ran rental classifieds. A "Cribliv Classifieds" module turns that heritage into listings → **contact-unlock**, the business model, without reading as an ad.

**Design stance: modern digital broadsheet, not skeuomorphic newsprint.** No yellowed paper, torn edges, or faux-print gimmicks (they read as kitsch, break on mobile, and cost CWV). The "newspaper" feeling comes ~80% from typography + hierarchy and ~20% from restraint (hairline rules, cool newsprint tone, a single press-red accent). Mobile-first: every multi-column device collapses to one readable column.

## 2. Design system (tokens)

Respects the plan's **"Fonts Inter / Manrope / Fraunces only"** constraint. (The mock used system serifs because the Artifact CSP blocks font CDNs; the real build uses the site's actual `--font-display` / `--font-inter`, which look more distinctive.)

**Type roles**

| Role                                         | Family                      | Treatment                                       |
| -------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Nameplate / masthead                         | Fraunces (`--font-display`) | 700, tight tracking, uppercase, big             |
| Headlines / deks / article body              | Fraunces                    | editorial serif reading voice; balance headings |
| Kickers · folio · bylines · data labels · UI | Inter (`--font-inter`)      | uppercase, `letter-spacing: .1–.14em`, small    |
| Admin/queue chrome                           | Manrope / Inter             | existing admin primitives                       |

Running measure ~65ch; type scale fixed; `text-wrap: balance` on headings; `font-variant-numeric: tabular-nums` on all figures.

**Color** (named; deliberately _not_ the cream+terracotta cliché — cooler paper, a true printing red)

```
--paper      #f1f0ea   cool newsprint off-white (page ground)
--paper-panel#e8e7de   panel ground (By the Numbers, classifieds body)
--ink        #1a1815   warm near-black printing ink (text, strong rules)
--ink-soft   #6a645c   warm grey (meta, captions, datelines)
--flag       #c2301c   printing vermilion — masthead flag, kickers, links, chart accent ONLY
--rule       #cbc9bf   hairline divider grey
```

Accent discipline: `--flag` appears only on the masthead rule, section kickers, links, and the emphasized data point. Everything else is ink on paper. Semantic states (admin queue) are separate from the accent.

**Structural devices** (each encodes real info, never decoration): thin/thick **folio rules**, **section kickers** (= category), **datelines** (= the post's city, ties to the programmatic surface), **bylines** (= author, links to bio), **column rules** between grid items.

## 3. The masthead system

Reusable header, not a one-off:

- **Nameplate** "CRIBLIV TIMES" (Fraunces) between a thin-over-thick top rule and a double bottom rule.
- **Ears** (left/right of nameplate): edition line (`Vol. I · No. 1`, `City Edition`).
- **Tagline:** _Rental Intelligence for Urban India_.
- **Folio bar:** date · cities · `cribliv.com` · "Free" — Inter uppercase.
- **Section nav (the "desks"):** Front Page · Market Reports · Neighbourhoods · Tenancy & Law · By the Numbers · Guides. Current desk underlined in `--flag`.

## 4. Section identities ("desks" = blog categories)

Map the plan's `blog_categories` onto named desks so the paper metaphor doubles as topical SEO clustering. Each desk is a landing page (hub filtered by category) with its own kicker label:

| Desk           | Category slug    | Purpose                                     |
| -------------- | ---------------- | ------------------------------------------- |
| Market Reports | `data-reports`   | rent indices, city reports (data-grounded)  |
| Neighbourhoods | `local-guides`   | area guides ("near Amity", localities)      |
| Tenancy & Law  | `tenancy`        | rights, deposits, agreements                |
| By the Numbers | `market-updates` | short data posts + the recurring data boxes |
| Guides         | (guides)         | evergreen how-to (first-timer checklists)   |

(Confirm final category set against Task 1's seed of 4 categories; "Guides" may fold into an existing one.)

## 5. Pages

### 5.1 Hub `/[locale]/blog` — "the front page" (Task 20)

Front-page hierarchy, not a uniform card grid:

- **Masthead** (§3).
- **Lead story:** kicker + large Fraunces headline + dek + byline/dateline + an **inline data chart** (§6) when the post carries data; two-column serif excerpt with a drop cap.
- **Rail:** a **By the Numbers** box (§6) + 2–3 secondary teasers separated by hairline rules.
- **Secondary strip:** 3 story cards under a double rule, column-ruled.
- **Cribliv Classifieds** module (§7).
- **Colophon** footer.
- ISR (revalidate hourly). Category desks reuse this layout filtered by category.

### 5.2 Detail `/[locale]/blog/[slug]` — "the article" (Task 21)

- Centered kicker + headline + byline/dateline; **drop cap** on the lede (in `--flag`).
- Serif body at ~65ch; **pull quotes** (`--flag` left border); inline **data charts** (recharts) with a **source line** ("Source: Cribliv listings data, n = …").
- Article + FAQPage + BreadcrumbList JSON-LD (from Task 19's `buildArticle`).
- **End-of-article bridge:** a "From the Classifieds" card → relevant listings/`Browse … on Cribliv →` (the unlock funnel).
- Semantic internal links (Task 13 embeddings) rendered as inline editorial links.
- `hero_image_path` renders as a captioned lead image (lazy, sized — CWV).

### 5.3 Author bio `/[locale]/blog/author/[authorSlug]` (Task 22)

E-E-A-T page: portrait, name, role ("Data Desk"), short bio, and the author's recent bylines. Person JSON-LD. Datelines/bylines across the site link here.

## 6. Data-journalism components

- **Charts as newspaper graphics:** recharts, but styled flat and editorial — ink line, faint grid, one `--flag` emphasized endpoint, clear axis labels, **always a source line**. No 3D, no gradients, no chartjunk.
- **By the Numbers box:** a bordered panel of sourced figures (median rents, days-on-market) pulled from `SeoAggregatesService`. Cheap to generate, high-trust, shareable/citable — and reinforces the data-desk identity. Tabular numerals.

## 7. Cribliv Classifieds (the monetization bridge)

A newspaper-classifieds strip (hub) + an end-of-article card (detail): 3–6 verified listings relevant to the post's city/category, each with title · locality · price · **Unlock contact →**. Sourced from the existing listings/search API, filtered by the post's dateline city + topic. This is the reader→contact-unlock path; it must look editorial (a classifieds column), never like a banner ad.

## 8. Responsive, performance, a11y

- **Mobile-first:** front-page grid → single column; masthead scales via `clamp()`; body columns collapse to one; classifieds/strip stack.
- **CWV:** ISR; `hero_image_path` lazy + explicitly sized (no CLS); no web-font FOIT (fonts already `display: swap` in `layout.tsx`); charts render at a fixed aspect box.
- **A11y:** ink-on-paper contrast ≥ 4.5:1 (verify `--ink-soft` on `--paper`); visible focus states on links/nav/unlock buttons; charts carry `role="img"` + descriptive labels; honor `prefers-reduced-motion` (the concept uses only a one-time load fade).

## 9. Mapping to the engine (what the pages consume)

- Task 19 must expose per-post: `title, dek/excerpt, category (→ desk), author (+authorSlug), dateline city, published/updated dates, hero_image_path, body (with internal-link anchors), data blocks (for charts / By the Numbers), FAQ`. If any field is missing from Task 19's shape, flag it back before building 20–24.
- Classifieds needs a listings query by `(city, topic)` — reuse the existing search endpoint.

## 10. Open decisions (review these)

1. **Skeuomorphism level** — the mock is "editorial/restrained." More classic (heavier rules, condensed heads) or more minimal?
2. **Section set** — confirm the 5 desks vs the seeded 4 categories (does "Guides" get its own desk?).
3. **Nameplate wordmark** — set in Fraunces as-is, or commission a bespoke lockup later? (Fraunces is strong enough to ship v1.)
4. **Classifieds density** — 3 (mock) vs a fuller 6-up column on the hub?
5. **Hindi masthead** — literal "क्रिबलिव टाइम्स" on `/hi`, or keep the Latin nameplate + Hindi content? (Recommend: Latin nameplate, Hindi content, for brand consistency.)
