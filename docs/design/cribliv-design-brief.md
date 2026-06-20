# Cribliv Design Brief — Fresh Redesign, Same Brand

**Goal:** A consistent, high-finish redesign of the Cribliv web product, designed in **Claude Design** and implemented in the existing Next.js app. New visual language and layouts; the brand (colors, logo, fonts) stays.

**Scope:** Web only (mobile deferred). Direction: **"Confident & editorial, map-forward."**

> **How to use this doc:** Work top to bottom. Generate the **Style Foundation** (Section 5) in Claude Design *first* and lock it. Then design each archetype (Section 6) telling Claude Design to "use the Style Foundation exactly." Hand approved designs back to engineering (Section 8).

---

## 1. Product context (paste into Claude Design for grounding)

Cribliv is a trustworthy home & PG rental search platform for North India (Lucknow, Gurugram, Noida, Delhi, Jaipur). It serves four roles:

- **Seekers/tenants** — search flats & PGs, browse on a map, shortlist, contact owners. Hold wallet credits; protected by "auto-refund credit if no response in 12h."
- **Owners** — post & manage listings, get leads, complete verification.
- **PG operators** — manage PG inventory (beds, sharing types, food, curfew).
- **Admin** — moderation & oversight.

Differentiators to celebrate in the design: **trust/verification** (verified vs pending badges, owner trust signals), the **flagship map experience**, and **speed**. Bilingual (English + Hindi). Money is in ₹.

## 2. Brand lock (do NOT change these)

| Token | Value |
|---|---|
| Primary / brand | `#0066FF` |
| Brand dark | `#0052CC` |
| Accent (coral) | `#FF5A5F` |
| Trust (green) | `#0D9F4F` |
| Warning (amber) | `#E88C00` / `#F59E0B` |
| Danger | `#DC2626` |
| Text primary | `#1A1A2E` |
| Headings font | Manrope |
| Body font | Inter |
| Logo | "CribLiv" wordmark + house mark (keep) |

These come from the live `apps/web/app/globals.css` ("CRIBLIV Design System v2.0"). Spacing stays on an **8pt grid**.

## 3. Open for redesign (everything else)

Layout & composition, radii, shadows/elevation, density, illustration/iconography style, photography treatment, map UI, type *scale* and weights, how boldly blue & coral are used.

## 4. Aesthetic direction — "Confident & editorial, map-forward"

**Do:**
- Generous whitespace; let content breathe.
- Large Manrope display headings; clear typographic hierarchy.
- Use brand blue **decisively** (not timid 1px accents).
- Reserve **coral for exactly one primary action per screen**.
- Treat the **map as a first-class hero surface**, not a side panel.
- Warm, human, trustworthy — North-India rental context, real photography.
- Trust signals (verified badges, refund guarantee) are visually prominent, never buried.

**Don't:**
- Corporate-fintech coldness, generic SaaS gradients, AI-template sameness.
- More than one coral CTA competing per screen.
- Cramped, data-dense dashboards — keep the editorial calm even in owner tools.

## 5. STEP 1 — Style Foundation prompt (generate this FIRST, then lock it)

> Paste verbatim into Claude Design. This is the reference every later screen points back to.

```
Create a single "UI Kit / Style Foundation" page for Cribliv, a trustworthy home & PG
rental platform for North India. Aesthetic: "Confident & editorial, map-forward" —
generous whitespace, large Manrope display headings, decisive use of brand blue,
warm and human, not corporate.

Lock these brand colors exactly:
- Primary blue #0066FF (dark #0052CC)
- Accent coral #FF5A5F  (use sparingly — one primary action per screen)
- Trust green #0D9F4F, Warning amber #E88C00, Danger red #DC2626
- Text #1A1A2E, on a clean white/near-white surface system
Fonts: Manrope for headings, Inter for body. Spacing on an 8pt grid.

Show, on ONE page:
1. Color swatches (brand, accent, semantic, surfaces, text, borders) with hex labels
2. Type scale: display, h1–h4, body, small, caption — Manrope/Inter, with weights
3. Buttons: primary (coral), secondary (blue), ghost, destructive — default/hover/
   focus/disabled/loading states
4. Form inputs: text field, select, search bar — default/focus/error states
5. Listing card (with photo, price ₹, verified badge, locality)
6. Chips/filters and tags (incl. "Verified", "Pending", BHK, furnishing)
7. Map marker styles (price pill marker, cluster, selected) + a listing bottom-sheet
8. Badges & trust signals (Verified, Auto-refund guarantee, owner trust)
9. Elevation/shadow scale and corner-radius scale

Keep it systematic and reusable — this is the design system other screens inherit.
```

## 6. STEP 2 — North-star archetypes (design in this order)

Prefix every prompt with: *"Using the Cribliv Style Foundation exactly (same colors, type, components), design…"*

1. **Homepage hero** — Confident editorial hero: big Manrope headline on trust + speed, a prominent search (city + locality + type), trust proof (verified listings, refund guarantee), a glimpse of the map. Sets the emotional tone.
2. **Cribliv Map (flagship)** — Map/list split layout. Price-pill markers, clustering, locality + metro-line overlays, filters, and a listing **bottom-sheet** on marker tap. This is the biggest design investment — make the map the hero.
3. **Listing detail** — Conversion screen: photo gallery, title + ₹ rent, verified/pending status, key facts (BHK, bath, furnishing), trust badges, owner block, sticky contact CTA (coral). Handle the **"Photos coming soon"** empty state gracefully.
4. **Owner dashboard** — Calm, editorial management surface: listings, leads, verification status, performance — not a cramped data grid.

## 7. STEP 3 — Owner walkthrough (design as a FLOW, not a screen)

4–6 connected frames with a persistent progress indicator and explicit empty/loading/success states:

`Welcome → Property details → Photos upload → Verification → Review → Published 🎉`

Prompt seed: *"Using the Cribliv Style Foundation, design a 5-step owner onboarding walkthrough for posting a rental listing. Show a progress stepper, one frame per step, plus the success state. Reassuring and simple — many owners are first-time, non-technical, bilingual EN/HI."*

## 8. STEP 4 — Handback to engineering (consistency at the code layer)

The redesign only stays consistent if the code has **one** source of truth. Today there are **two drifting token sets**: `apps/web/app/globals.css` and `packages/ui/src/tokens.ts` (different values). Before/alongside implementation:

1. **Consolidate to one canonical token source** that both web (and later mobile) read from.
2. Map the approved Claude Design output onto those tokens (no hardcoded hex in components).
3. Implement archetype-by-archetype in the Next.js app, verified in live preview.
4. Build the reusable component set (from Section 5) once; compose screens from it.

## 9. Consistency checklist (apply to every screen before accepting it)

- [ ] Only brand-locked colors used; no stray hexes
- [ ] Exactly one coral primary action
- [ ] Manrope headings / Inter body, 8pt spacing rhythm
- [ ] Components reused from the Style Foundation (not reinvented)
- [ ] Trust/verification signals present where relevant
- [ ] Empty / loading / error states designed, not just the happy path
- [ ] Bilingual EN/HI text won't break the layout (Hindi runs longer)
