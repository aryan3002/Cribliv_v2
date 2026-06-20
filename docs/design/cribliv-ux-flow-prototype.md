# Cribliv — Full UX Flow & Interactive Prototype Brief

Everything below is extracted from the **real codebase** (49 routes). Use it to build a high-fidelity, interactive prototype in **Claude Design** that mirrors the actual product — not a generic one.

---

## 0. How to use this

1. In Claude Design, set the active **Design system → Cribliv UI Kit**.
2. Build **one FLOW at a time** as a new **Product prototype** (each flow = a set of linked screens). Pasting a whole flow block gives you an interactive, navigable prototype for that journey.
3. Each screen lists its **→ links** — wire those so the prototype is clickable.
4. Aesthetic on every screen: **confident & editorial, map-forward** — generous whitespace, large Manrope display headings, brand blue used decisively, **coral `#FF5A5F` for exactly one primary action per screen**, trust signals prominent. Design **desktop + mobile**.

**Build order (highest impact first):** A (Seeker discovery) → B (Auth & account) → C (Owner) → D (PG operator) → E (Rent agreement) → F (Admin) → G (Marketing/system).

---

## 1. Canonical content truths (keep identical across every screen)

- **Brand:** blue `#0066FF`, coral `#FF5A5F` (one primary action/screen), trust green `#0D9F4F`, amber `#E88C00`. Manrope headings / Inter body.
- **8 cities:** Delhi, Gurugram, Noida, Ghaziabad, Faridabad, Chandigarh, Jaipur, Lucknow.
- **Trust pillars (everywhere):** *Verified Owners* · *12-Hour Refund* (auto-refund credit if no response in 12h) · *Zero Brokerage*.
- **Pricing:** **₹49** per contact unlock. Wallet credits; **1 credit = 1 unlock**. Auto-refund if owner doesn't respond in 12h.
- **Languages:** English + हिंदी (Hindi runs longer — don't let it break layouts).
- **Two verticals (separate surfaces):** **Homes** = `flat_house` at `/search` + `/listing/:id`. **PG** = `/pg` + `/pg/:city/:id`. A segmented **Homes | PG** toggle switches between them.
- **Listing statuses:** `draft` (Draft/slate) · `pending_review` (Pending/amber) · `active` (Active/green) · `rejected` (Rejected/red) · `paused` (Paused/amber) · `archived` (gray).
- **Lead stages:** New → Contacted → Visit scheduled → Deal done → Lost.
- **Verification states:** Unverified · Verification Pending · Verified · Verification Failed.
- **Voice agent persona:** **Maya**, the AI listing concierge (Hindi/English; "नमस्ते! Boliye…").

---

## 2. GLOBAL SHELL (applies to every consumer screen)

```
Build the Cribliv global shell — a sticky Header and a Footer used on all public/consumer screens.
Use the Cribliv UI Kit. Aesthetic: confident & editorial.

HEADER (sticky, gains shadow on scroll):
- Left: "cribliv" wordmark logo → links to Home.
- Center nav (desktop): "Search" → /search · "Saved" → /shortlist · "Rent Agreement" → /rent-agreement.
- Right: "Post Property" (with + icon) → /owner/dashboard · a language pill (Globe icon) toggling EN ↔ हिंदी · a hamburger menu.
- Logged-OUT menu: "Login / Sign up" → /auth/login, plus Explore links (Search rentals, CriblMap, Become an owner, How it works, Help & FAQ).
- Logged-IN menu: avatar (last 2 digits of phone) + "+91 XXXXX XXXXX" + role label; Account settings → /settings; My saved → /shortlist; role extras (owner: "My listings"; pg_operator: "PG dashboard" + "New PG listing"; admin: "Admin"); "Sign out".

FOOTER (4 columns):
- Brand: logo + "AI-powered verified rental search for North India" + "Verified owners only".
- Explore: Search Rentals, CriblMap, How It Works, Noida, Delhi, Gurugram.
- For Owners: List Your Property, Owner Dashboard, Verification.
- Company: About Us, Contact, Privacy Policy, Terms of Service, FAQ, Pricing.
- Bottom: "© 2026 Cribliv. All rights reserved." · "Made with ♥ in India".

Design the header in three states: logged-out, logged-in (tenant), and the mobile hamburger sheet.
```

---

## 3. FLOW A — Seeker discovery & search  ⭐ (the core journey)

```
Build the Cribliv seeker discovery flow as an interactive prototype — these linked screens:
HOME → SEARCH RESULTS → CRIBLMAP → LISTING DETAIL, plus PG BROWSE → PG CITY → PG DETAIL.
Use the Cribliv UI Kit + global header/footer. Aesthetic: confident & editorial, map-forward.
Currency ₹. Cities: Delhi, Gurugram, Noida, Ghaziabad, Faridabad, Chandigarh, Jaipur, Lucknow.

────────────────────────────────────────
SCREEN 1 — HOME  (/[locale])
- Full-bleed MAP HERO: overline "AI-Powered Rental Search" (sparkle); H1 "Find your perfect home,
  verified & hassle-free" (the word "verified" in blue); subtitle "AI matches you with verified rentals
  across Delhi NCR and North India. No brokers, no fake listings, no hidden charges."
- The agentic SEARCH BAR: a Homes | PG segmented toggle + a natural-language input
  (placeholder "e.g. 2BHK near Cyber City under 35k") with a mic (voice) button. Below it, live
  "✦ Understood as" chips (e.g. "2 BHK", "Under ₹35k", "Furnished"). Primary action submits → SEARCH.
- Glass TRUST STRIP over the hero: "Verified Owners" (shield) · "12-Hour Refund" (clock) · "Zero Brokerage" (₹).
- "Explore Top Cities" — grid of 8 city cards (map imagery) → /city/<city>.
- "Popular in Lucknow" — horizontal locality pills with listing counts → filtered search.
- Three listing CAROUSELS: "Popular homes in Lucknow", "Trending PGs in Lucknow", "Furnished homes in Lucknow"
  (use the listing card from Screen 2).
- "How It Works" — 3 numbered steps: Search Naturally · Verified Listings · Connect & Move.
- "Powered by AI" — 3 tiles: CriblMap (badge "New") → /map; "Maya, your voice listing agent" (badge "AI Voice",
  mic, bubble "नमस्ते! Boliye…") → /owner/listings/new; "Search the way you talk" → /search.
- "Our Impact" (dark band): ₹0 Brokerage · 100% Owner Verified · 12hr Refund Guarantee · 8+ Cities.
- Testimonials "Loved by Tenants" (3, 5-star, e.g. "Saved ₹40k in brokerage").
- Owner CTA banner: "Own a property? List it free." → primary "List Your Property" → /owner/dashboard.
→ links: search bar → SCREEN 2; city cards → SEO CITY; CriblMap tile → SCREEN 3; listing cards → SCREEN 4.

────────────────────────────────────────
SCREEN 2 — SEARCH RESULTS  (/[locale]/search)  — flats & houses only
- Single-column (NOT split map). Top: the Homes|PG segmented search bar (segment = Homes).
- FILTER BAR: Sort (Relevance / Newest First / Verified First / Rent: Low→High / High→Low);
  a "Save Search" button (bell); City select (8 cities); BHK chips 1–5; Furnishing select
  (Any / Fully Furnished / Semi-Furnished / Unfurnished); Min ₹/mo + Max ₹/mo inputs; "Verified only" checkbox.
- Header row: H1 "Rentals in Delhi — "2 BHK"" + "{N} results" + a "View on Map" pill → CRIBLMAP.
- Active filter chips (each removable with ×): e.g. "City: Delhi", "2 BHK", "Verified Only", "Clear all".
- RESULTS GRID of LISTING CARDS. Each card: cover photo (or building-icon placeholder); a top-left
  "Verified" badge (shield) when verified; a heart/save button; a type pill "Flat / House"; title;
  "{locality}, {city}" with pin; meta chips "{bhk} BHK", "{area} sqft", furnishing; price row
  "₹{rent}/month" + a trailing "Zero brokerage" tag.
- Pagination (Prev / 1 2 … N / Next).
- EMPTY state: search icon, "No listings match your search", "Try adjusting your filters…", "Clear Filters".
- ERROR state: "We couldn't reach our servers", "Retry Search" + 4 popular-city links.
→ links: card → SCREEN 4; "View on Map" → SCREEN 3; segment PG → SCREEN 5.

────────────────────────────────────────
SCREEN 3 — CRIBLMAP  (/[locale]/map)  ⭐ flagship — the map IS the hero
- Full-viewport interactive map. Chrome floats over it (not a side panel).
- TOP BAR: brand "cribliv · Map"; a Places search input "Search locality or area…" (with ⌘K hint);
  inline filter chips (BHK ▾ [Any/1/2/3/4+], Rent ▾ [Any/Under ₹10K…₹50K], "PG" toggle, "✓ Verified" toggle);
  a Map | List view toggle (List → SCREEN 2).
- MARKERS = price pills: "{2BHK · ₹18K}" / "{PG · ₹9.5K}". Verified pins show the Cribliv mark and are
  visually dominant; unverified are muted; "below market" pins get a highlight. A selected pin is emphasized.
- Marker HOVER popover: cover photo, big "₹{rent}/month", "{bhk} BHK · {furnishing}", title, a
  "Cribliv Verified" or "Unverified" badge. Clicking a pin → LISTING DETAIL.
- CLUSTERING when zoomed out: a round cluster chip "{count}" with "{n} verified" sublabel.
- RIGHT TOOLBAR (6 tools, icon + label): Stats (draw an area to analyze) · Metro (toggle metro lines) ·
  Seek (drop a search pin) · Demand (show seeker demand) · Commute (set office for "where should I live") · Insight.
- BOTTOM BAR (live counts): "{total} listings in view · {verified} verified · {n} below market" + "Is my rent fair?"
- METRO overlay: colored line polylines + station dots; station tooltip shows line + "Stop i of N" + interchanges
  + "walk time from this listing" + "{n} rentals within 500 m".
- SIDE PANEL (desktop slide-in / mobile bottom-sheet) for: Area Statistics (listings in area, rent trend,
  verified %, per-BHK avg-rent table, "Save as Alert Zone"); "Drop Search Pin" (budget range, radius chips
  500m/1km/2km/3km, BHK multiselect, move-in timing ASAP/1mo/3mo/Flexible, type, note); Locality Insight.
- "Is My Rent Fair?" MODAL: BHK chips, furnishing chips, "Your Current Monthly Rent ₹__" → verdict band
  "Below Market! 🎉 / At Market ⚖️ / Above Market ⚠️" with a p25–median–p75 range bar.
- COMMUTE overlay ("Where Should I Live?"): office address input + "within {N} min of work" slider; pins fade
  by reachability (green/amber/out).
- MOBILE: full-screen map + a draggable bottom-sheet list + a floating "Filters" button (with active count).
- States: loading "Loading listings…"; empty "No listings in this area / Try zooming out…".
→ links: pin → SCREEN 4; List toggle → SCREEN 2.

────────────────────────────────────────
SCREEN 4 — LISTING DETAIL  (/[locale]/listing/:id)  — the conversion screen
- Breadcrumb: Home › {City} › {title}.
- Title toolbar: a "Verified" (shield) OR "Verification Pending" (clock) badge + a "Flat / House" badge;
  H1 = title; meta "📍 {City}, {locality} · 📷 {n} photos · 🛡 Auto-refund credit if no response in 12h";
  right: Share + Save (heart) actions.
- GALLERY: 1 big photo + up to 4 thumbnails, "Show all photos · {n}" → lightbox. EMPTY state = a camera
  icon + "Photos coming soon".
- Highlight chips: "{bhk} BHK", "{bathrooms} bath", "{area} sqft", furnishing, "Flat / House".
- "About this property" (description).
- "Listed by {owner}" host card: avatar, "On Cribliv since {year} · English, हिन्दी", pills
  "Verified owner", "Auto-refund credit if no response in 12h", "WhatsApp ready".
- "What this place offers" — amenities grid (8 shown; offered first, unavailable greyed "Not included";
  "Show all amenities · {n}" opens a categorized modal).
- "Things to know" — 3 cards: Move-in & lease (Available from / Deposit ₹ / 11-month agreement);
  Preferred tenants + rules (e.g. ✗ No smoking, ✓ Pets with approval, ✗ No loud noise after 11 PM);
  "Cribliv guarantees" (✓ Verified owner · ✓ Auto-refund in 12h · ✓ No broker spam).
- "Where you'll be": map card, "Exact address shared after you unlock the owner's contact", "Explore on
  CriblMap →" (→ SCREEN 3). Plus a demand badge "🔥 {n} active seekers match this listing nearby".
- "Market Rate · {bhk}BHK in {City}": 3 stats ₹P25 Budget / ₹P50 Fair Market / ₹P75 Premium, a green→amber→red
  bar with a marker at this listing's rent, and a pill "Great deal / Fair price / Above market" + "This listing: ₹{rent}/mo".
- STICKY RIGHT RAIL — the UNLOCK panel: "Unlock contact for 1 credit. Auto-refund if no response in 12 hours.";
  "Wallet balance {n} credits" (if logged in); primary coral button "Unlock Number"; secondary "Save";
  reassurance "You won't be charged unless the owner picks up — auto-refund in 12h."
- UNLOCK states to design: (a) logged-out → inline OTP (phone → "Send OTP" → 6-digit → "Verify & Unlock"),
  (b) success green block "Owner Contact: +91 ..." + "Credits remaining: {n}" + "Refund auto-check at: {time}",
  (c) "Not enough credits" → "Buy Credits" panel (plan, "Open UPI App", "Refresh Balance").
- "Similar properties nearby" carousel.
- Mobile sticky CTA bar: "₹{rent}/mo" + "View Contact".
- EMPTY (not found): "Listing Unavailable" + "Browse Listings" → SCREEN 2.
→ links: Unlock → OTP/login (FLOW B); Save → SHORTLIST; Explore on CriblMap → SCREEN 3; similar → SCREEN 4.

────────────────────────────────────────
SCREEN 5 — PG BROWSE  (/[locale]/pg)
- Same single-column layout as SCREEN 2 but PG-specific. Search bar segment = PG ("Search PGs by city or area…").
- H1 "PGs in {City}" / "Find Verified PGs" + "{N} results".
- PG FILTERS: Gender (Boys / Girls / Co-ed); Sharing (Single / Double / Triple / Quad);
  Tenant (Students / Working / Any); More (AC, Food included); Sort (Relevance / Newest / Rent: Low→High).
- PG CARD: cover (or building placeholder); "Verified" badge; title; "{locality}, {City}"; a badge row —
  gender ("Boys"/"Girls"/"Co-ed"), "Food" (if meals), one badge per sharing type ("Single"/"Double"/…);
  price "from ₹{rent}/month".
- Pagination; EMPTY "No PGs match your filters" + "Clear filters".
→ links: card → SCREEN 7; segment Homes → SCREEN 2.

────────────────────────────────────────
SCREEN 6 — PG CITY LANDING  (/[locale]/pg/:city)
- Hero band: breadcrumb (Home › PG › PG in {City}); H1 "Verified PGs in {City} — Zero Brokerage"; intro;
  primary "Browse all {City} PGs" → SCREEN 5.
- "Verified PGs in {City}" — grid of PG cards (if inventory).
- "Average PG Rent in {City}" — 3 cards Single / Double / Triple sharing with ₹ ranges.
- "Top PG Localities in {City}" — locality pills → filtered PG search.
- FAQ accordions; "Explore PGs in other cities" pills.
→ links: → SCREEN 5, SCREEN 7.

────────────────────────────────────────
SCREEN 7 — PG DETAIL  (/[locale]/pg/:city/:id)
- Breadcrumb Home › PG › {City} › {title}.
- Title toolbar: "Verified" + "PG / Hostel" badges; H1; "{locality}, {city}"; Share.
- Quick-facts strip: gender ("Boys Only"/"Girls Only"/"Co-ed"); tenant ("Students"/"Working Pros"/"All Welcome");
  "{n} beds total"; "Meals included"; "Negotiable" (if so).
- Gallery (same as SCREEN 4, "Photos coming soon" empty).
- "Room options" — cards per sharing type: "{Single/Double/…} sharing", "₹{rent} per person / month",
  chips "AC", "Attached Bath"/"Shared Bath", "Furnished"/"Semi-Furn", "From {date}".
- "What this place offers" — amenities grouped Security / Comfort / Kitchen / Facilities, "Show n more".
- "Food & Meals" — "Meals Included", meal-time chips (Breakfast/Lunch/Dinner), optional "₹{x}/month extra".
- "House rules" — Allowed / Not Allowed over Smoking, Alcohol, Non-veg, Pets, Cooking in room; "Quiet hours {from}–{to}".
- "Things to know" — deposit, notice period, lock-in, electricity mode, rent due day, payment modes.
- "Where you'll be" (text location).
- STICKY RAIL: "from ₹{rent}/month" + "₹{deposit} security deposit"; room-type list; gender/tenant facts;
  primary "I'm interested"; reassurance "Owner will contact you directly"; payment modes.
  (Interest is lead-based — NO unlock/payment gate. Logged-out → "Log in to show interest".)
- "Similar PGs nearby"; mobile CTA bar "Show Interest".
→ links: "I'm interested" → login (FLOW B) → success "The PG owner has your interest — they'll reach out."

Wire SCREEN 1's search bar and cards into 2/3/4/5/6/7. Design desktop + mobile for each.
```

**SEO landing template (one prompt, render as variants):** city / locality / metro-station / near-landmark pages share an anatomy — breadcrumb → H1 with map-pin → a stats card (Listings · PG · Flats · medians) → optional intent grid → a listings grid ("View all" → `/search?...`) → related links (nearby metro/landmarks/localities) → FAQ accordions → CTA. Templated H1s: *"Verified Rentals in {Locality}, {City}"*, *"2 BHK Flats in Gomti Nagar"*, *"PG for Girls in {place}"*, *"Rentals near {Station} Metro"*, *"Rentals near {Landmark}"*. These are crawlable on-ramps that all funnel into Search.

---

## 4. FLOW B — Auth & seeker account

```
Build the Cribliv auth + seeker account flow. Use the Cribliv UI Kit. Aesthetic: confident & editorial.

SCREEN — LOGIN  (/auth/login)  — full-bleed, NO header/footer
- Premium "auth canvas": soft aurora/orbs + a subtle animated city-skyline silhouette.
- Centered: brand lockup; title "Welcome back." / "Welcome home." (signup); subtitle
  "Two minutes. No brokers. No passwords."; a pill tab switcher Log in / Sign up.
- Step 1: "Mobile number" with a 🇮🇳 +91 prefix (placeholder "98765 43210"); primary "Continue with OTP".
- Step 2: a 6-digit code input (• • • • • •); a dev chip "Dev mode — mock OTP auto-filled · No SMS sent";
  primary "Verify & Sign in"; "← Change number".
- Trust row "Trusted by verified owners across India"; fine print "By continuing, you agree to Terms and Privacy."
- States: "Sending…", "Verifying…", error (invalid OTP / expired / rate-limited).

SCREEN — TENANT DASHBOARD  (/[locale]/tenant/dashboard)  "My Account"
- H1 "My Account" + "{phone}" + role badge.
- "Available Credits" amber card: big "✦ {n}" + "Each credit unlocks one owner's contact. You have {n} unlocks."
- Quick-link cards: "Browse Properties" → /search · "Saved" → /shortlist · "Back to Home".
- "Sign out".

SCREEN — SAVED HOMES  (/[locale]/shortlist)
- H1 "Saved Homes" + sub ("Guest saves are stored on this browser. Login to sync." / "Synced with your account.").
- Grid of listing cards with a filled heart (click removes).
- EMPTY: heart icon, "No saved homes yet", "Browse verified rentals and tap the heart to save them here.",
  "Browse Listings" + "Explore Cities".

SCREEN — SETTINGS  (/[locale]/settings)  "Account Settings"
- "Account Information" card: Phone (read-only, "cannot be changed"); Role (if tenant → "Become Owner" button);
  "Credits Balance ✦ {n}".
- "Personal Settings" card: Full Name input; Preferred Language toggle 🇬🇧 English / 🇮🇳 हिंदी;
  "WhatsApp notifications" toggle.
- "Save Changes" (disabled until changed); a success toast "Settings saved successfully".
- "Account Actions": "Sign Out".

Also design "Save Search" as a small flow on Search: a bell button → "Saving…" → "✓ Saved!".
Design desktop + mobile.
```

---

## 5. FLOW C — Owner journey

```
Build the Cribliv owner flow as a linked prototype. Use the Cribliv UI Kit. Aesthetic: confident &
editorial — calm, spacious, NOT a cramped data grid. Currency ₹.

SCREEN — BECOME OWNER  (/[locale]/become-owner)
- Hero: overline "For Property Owners"; H1 "List Your Property on Cribliv"; subtitle "Zero commission.
  Verified tenants. AI-matched leads — all for free."; CTAs "Start Listing Now" → wizard, "List a PG".
- "3 Simple Steps to Start Earning": Create Your Listing · Get Verified ("Verified owners get 3x more leads") ·
  Receive Tenant Leads.
- Trust strip: Zero commission forever · AI-matched tenant leads · Verified badge for trust.
- Stats: 100% Free to List · 3x More Leads (Verified) · 8 Cities Covered.
- Role-upgrade card: "Select your role" → two tiles "Property Owner" / "PG Operator" → "Get {role} access →".
  Plus states: "Request submitted! …pending admin approval (within 24 hours)" and "🎉 You are now a {role}!".

SCREEN — OWNER DASHBOARD  (/[locale]/owner/dashboard)  — the hub
- Dark gradient hero: eyebrow "Owner workspace · Synced HH:MM"; greeting "Good morning, {FirstName}.";
  subtitle "{N} listings under your roof. {M} tenants reaching out."; actions "Create listing" (+) + settings.
- Floating STAT CARD (5 chips): Active "Visible to tenants" · Pending review "With Cribliv team" ·
  Drafts "Not yet submitted" | New leads (7d) "▲ N vs prior 7d" · Total listings.
- Verification banner: "Some active listings aren't verified yet. Complete verification… Verify now →".
- TABS: "Listings" (badge) · "Leads" (badge).
- LISTINGS tab: status filter chips (All / Drafts / Pending / Active / Rejected / Paused with counts);
  grid of listing cards — cover, a verification ribbon (Verified ✓ / Pending / Failed), a status chip,
  title, "{locality}, {city}", "₹{rent}/mo", a "seekers nearby" widget, and actions:
  Live/Paused toggle, "Edit" (or "Fix & Resubmit" if rejected), "Boost" (zap).
- "Boost" MODAL: two plan groups "⭐ Featured — appears at top of search" and "🚀 Boost — increased
  visibility in feed", plan cards with ₹ + duration, footer "Pay ₹{amount}".
- LEADS tab: toolbar "Your leads · {total} total · {thisWeek} this week"; search "Search tenant, listing,
  phone…"; Board / List toggle; "Export" (CSV). A 5-column KANBAN — New (blue) · Contacted (amber) ·
  Visit scheduled (indigo) · Deal done (green) · Lost (gray). Cards: listing title, tenant avatar + name +
  masked phone, "Enquired {date}", notes. Drag between columns; stepper buttons "Mark Contacted", "Schedule
  visit", "Deal done", "Lost", "Re-open". A lead-stats widget (5 counts + progress bars).
- Footer cards: "Verification → Verify" and "Property management → Get help".
- EMPTY listings: "Your portfolio starts here." + "Create listing". Loading: skeleton cards.

SCREEN — LISTING WIZARD  (/[locale]/owner/listings/new)  — 6 steps + Maya voice
- Two-column shell: left = step card + Back/Next; right = "Maya · your listing concierge" panel with an
  animated voice ORB (tap to talk; "What we've captured {filled}/11"; fields glow gold when AI-filled) +
  "or switch to typing". Topbar "Talk to Maya / End voice".
- Step indicator (6 numbered chips): Basics · Location · Details · Title & Description · Photos · Review.
  1 BASICS: Property (Flat/House | PG/Hostel); Furnishing; Monthly rent ₹ (required); Security deposit ₹.
  2 LOCATION: City (8); Locality (Google Places autocomplete, "pinned" badge); a dark mini-map (drag pin,
     shows lat/lng); Nearest landmark; Pincode; Full address ("Kept private. Tenants only see locality + landmark").
  3 DETAILS: if PG → Total beds + Sharing + toggles Meals included / Attached bathroom (a banner: ≤29 beds
     "you can manage this yourself — self-serve"; >29 "our team will reach out to onboard you"); if Flat →
     Bedrooms + Bathrooms + Preferred tenant (Anyone/Family/Bachelor/Female only/Male only). Both: Carpet area +
     Amenities multiselect pills.
  4 TITLE & DESCRIPTION: a "Draft for me" AI button (typewriter-fills title + description); Title; Description.
  5 PHOTOS: a dropzone "Click or drop photos here · JPG/PNG up to 10MB"; a thumbnail grid, drag to reorder,
     first slot = cover; "Upload all".
  6 REVIEW: a tenant-facing preview card (cover, type badge, title, location, "₹{rent}/month", stat grid
     Bedrooms/Bathrooms or Beds/Sharing + Sq ft + Furnishing + Deposit, description, amenity chips).
- Nav: Back / Next; on Photos → "Submit for review" → status pending_review → back to dashboard.

SCREEN — OWNER VERIFICATION  (/[locale]/owner/verification)
- Narrow column. A "Listing" selector dropdown.
- Status card keyed by state: "Get Verified" / "Verification In Progress" / "Verification Passed" /
  "Verification Failed", with a status pill and a "Match score {n}%" bar (threshold 85%).
- "Video verification" card: upload video + reference code → "Submit Video Verification".
- "Electricity verification" card: Consumer ID + upload bill + address text → "Submit Electricity Verification".
- "Submission history" timeline: per attempt — type (Video selfie / Electricity bill), status, machine result,
  address match score, liveness score, provider, submitted-at.

Wire: become-owner → wizard → verification → dashboard (Listings ⇄ Leads). Design desktop + mobile.
```

---

## 6. FLOW D — PG operator journey  (dedicated DARK theme)

```
Build the Cribliv PG-operator flow. DARK glassmorphism theme (distinct from the light consumer app),
brand blue accents, framer-motion polish. Use the Cribliv UI Kit tokens. Currency ₹.

SCREEN — BECOME PG OPERATOR  (/[locale]/pg-operator/become)
- A single centered splash card with spring transitions; states: "Setting up your account" (floating
  sparkles + 3-dot loader) → redirect; "You already manage properties" (owner block, V1.5 note); "Request
  Under Review" ("we'll email you within 1 business day"); "Sign in to continue".

SCREEN — PG ONBOARDING  (/[locale]/pg-operator/onboarding)
- H1 "How big is your PG?"; one field "Total beds" (1–500); "Continue". (Small PG → wizard; large → lead form.)
- The large-PG LEAD form (/onboarding/lead): "Let's help you onboard" — Total beds, City, Phone, Notes →
  "Submit" → "Thanks — we'll reach out within a business day."

SCREEN — PG DASHBOARD  (/[locale]/pg-operator/dashboard)
- Header: "Welcome back, {FirstName} 👋"; H1 "Your PG dashboard"; "+ New listing".
- "Insights" — 6 cards: Live listings ({active}/{total}) · Avg listing quality · Open vacancies ·
  Lead conversion (%) · New leads · Top performer (views).
- "Portfolio analytics": a KPI strip (Search appearances · Views · Leads · Click-through · Conversion, each
  with ▲▼ vs last week) + a 30-day trend chart + a funnel + search insights (top queries, zero-result queries).
- "Continue your draft" rows (if drafts).
- "Your listings" — a bento grid of listing-health cards: cover, status badge, "from ₹X/mo", title,
  "{locality}, {City}", chips (gender · "{n} beds" · "{n} vacant"), stats Views/Leads/CTR, a "Listing quality
  {score}/100" bar, a 7-day views sparkline. Plus an "Add another listing" CTA card.
- "Leads pipeline" — 5-column kanban (New · Contacted · Visit scheduled · Deal done · Lost); cards show a
  masked phone + source + a "Reveal contact" button (eye). Empty: "No leads yet".

SCREEN — PG LISTING WIZARD  (/[locale]/pg-operator/listings/new)  — 7 steps
- Entry chooser first: "How would you like to list?" → tiles "Type it myself" / "Talk to list" (mic, AI fills).
- Wizard shell: left form + right rail with a voice ORB ("Maya · ready") and a live "quality meter" with
  go-to-step links. Step indicator (7): Basics · Location · Rooms & Pricing · Food & Amenities ·
  Rules & Agreement · Photos · Review.
  1 BASICS: Listing title; Property (building) name; "Who is it for?" (Boys/Girls/Co-ed); Tenant type
     (Students/Working/Any); Total beds (stepper); Total floors.
  2 LOCATION: City; Locality; Address (Places autocomplete); a dark interactive map (drop pin); optional
     "nearby metro / college / office" tag inputs.
  3 ROOMS & PRICING: a list of room-type cards — Sharing (Single/Double/Triple/Quad), AC toggle,
     "Monthly rent" ₹, "Vacancy count"; "+ Add room type".
  4 FOOD & AMENITIES: meals toggle (Not provided / Provided / Veg only) + optional meal charge; amenity
     chip groups Core / In-room / Services / Extras.
  5 RULES & AGREEMENT: "what's allowed?" chips (Smoking/Alcohol/Non-veg/Pets/Cooking) + quiet hours
     (22:00–06:00); Security deposit; Notice period (15/30/60 days); Electricity (Flat/Sub-metered/Split);
     payment modes (UPI/Bank/Cash).
  6 PHOTOS: uploader, min 4 photos ("listings with photos get 3× more interest").
  7 REVIEW & PUBLISH: read-only recap cards with Edit jumps + a quality meter; "Submit for review".

SCREEN — PG LISTING MANAGE  (/[locale]/pg-operator/listings/:id)
- A "submitted 🎉" banner when just published. Hero: status badge + title + "{Locality}, {City}".
- "Visibility & controls": Live / Paused toggle, "Edit listing", "Archive" (danger, confirm).
- "Listing quality {score}/100" with tier (Basic/Good/Excellent) + recommendations "{label} +{points}".
- Overview stats (6): Starting rent · Total beds · Vacancies · Gender · Tenant · Deposit.
- "Rooms & pricing" table (Sharing · Type · Rent/mo · Vacancy · Available).
- "Food & amenities" + "Agreement & payment" KV cards.

Wire: become → onboarding → dashboard → wizard → manage. Design desktop + mobile.
```

---

## 7. FLOW E — Rent agreement  (light, wizard-driven)

```
Build the Cribliv rent-agreement flow. Use the Cribliv UI Kit. Light theme. A small "DEV — Mock payment +
e-stamp + e-sign" banner at top. Currency ₹. Plans: basic / standard / premium.

SCREEN — AGREEMENTS LIST  (/[locale]/rent-agreement)
- Breadcrumb (Home / Rent agreements). H1 "Rent agreements" + "Create, finish, and download legally
  formatted rent agreements." + "New draft".
- Draft rows: file icon + "{Plan} agreement, ₹X/month" + "{id} · Step {n} · {status}" + a status badge + date.
- Empty "No drafts yet. Start with a plan, then fill the agreement step by step."

SCREEN — NEW DRAFT  (/[locale]/rent-agreement/new)  — public
- H1 "New rent agreement" + "Pick the document package and language."
- Plan picker: radio cards per plan (name + "₹{amount}" + feature list). "Agreement language" select
  (English / हिन्दी). Primary "Create draft" (or "Sign in to continue").

SCREEN — AGREEMENT OVERVIEW  (/[locale]/rent-agreement/:id)
- H1 "{Plan} agreement" + a status badge. "Agreement progress" panel: "Continue step {n}" (or "Continue to
  checkout"). Summary: Plan · Completed "{x} of {N} sections" · Monthly rent · Stamp duty · Updated.
- Right "Sections" rail: ordered step links with ✓ when validated (Parties → Property → Terms → Inventory
  and utilities → Clauses and witnesses → [Signatures] → Review).

SCREEN — WIZARD STEP  (/[locale]/rent-agreement/:id/step/:step)
- H1 "{step title}" + "Step {n} of {N}". Left = the step form; right = the Sections rail. "Save and continue".
  1 PARTIES: Landlord + Tenant fieldsets (Full name, Father name, Age, Phone, Email, Permanent address,
     PAN, Aadhaar last 4; tenant adds Company).
  2 PROPERTY: Full address, Property type (Flat/House/Villa/PG room/Shop/Office), Area, Furnishing, Purpose
     (Residential/Commercial/Mixed); identifiers (parking, floor, flat no, etc.).
  3 TERMS: Agreement type (New/Renewal), Agreement date, Commencement date, Tenure (months), Lock-in,
     Notice period, Monthly rent ₹, Security deposit ₹, Annual increment %, State, City, "registration
     required" acknowledgement (auto for tenure > 11 months).
  4 INVENTORY & UTILITIES: inventory item rows (name/qty/condition); Rent due day; payment method; late
     penalty %; maintenance + who pays electricity/water/gas/society.
  5 CLAUSES & WITNESSES: clause checkboxes (Pets/Subletting/Renovation/Commercial use); Max occupants;
     additional terms; Witness 1 + Witness 2.
  6 SIGNATURES (premium only): two signature-capture pads (Landlord + Tenant) with Draw / Upload tabs.
  7 REVIEW: "Final confirmation" + "I agree to the terms" checkbox + "Continue to checkout".

SCREEN — CHECKOUT  (/[locale]/rent-agreement/:id/checkout)
- H1 "Checkout" + status badge. "Payment" panel: primary "Pay now" (Razorpay) → "Status: Generating PDF…".
- Summary aside: Plan · Monthly rent · Stamp duty · Downloads "{n}/5".
- "Final agreement" panel (when generated): "Download PDF" ("{n} of 5 downloads used · preview unlimited") +
  an embedded PDF preview.

Wire: list → new → overview → step 1..7 → checkout. Note basic/standard skip Signatures (step 6). Desktop + mobile.
```

---

## 8. FLOW F — Admin console  (single route, 12 tabs)

```
Build the Cribliv admin console. A dense but clean operator UI: left sidebar + topbar + main. A ⌘K command
palette ("Jump to a tab, find a user, run an action…"). Use the Cribliv UI Kit.

SIDEBAR (groups → items): Operate [Live Operations, Overview] · Work [Listing Review, Verifications, CRM,
Fraud Feed — each with a count badge] · Understand [Revenue, Rent Agreements, PG Overview, PG Listings,
Users] · System [System Tools]. Footer "Sign out". Topbar: tab title + "Jump to anything (⌘K)" +
"updated {time}" + Refresh.

Design these tab views (all are client views on one /admin route):
1 LIVE OPERATIONS (default) — KPI cards: Leads·24h, Unlocks·today, Fraud·open, Verifications pending,
  Listings pending review, Voice sessions live; an hourly unlock area-chart; "Fresh signals" feed; an
  "Action queue".
2 OVERVIEW — 30-day cards (Total/Active listings, Total users, Unlocks, Revenue); a conversion funnel
  (Views → Enquiries → Unlocks → Leads); owner response rate; "Listings by city" bar chart.
3 LISTING REVIEW — moderation queue. Filter chips All/Flat/House/PG; a table (Title · Type · City · Rent ·
  Status · Verification · Submitted); row opens a drawer with a "Reason" textarea + Pause / Reject / Approve.
4 VERIFICATIONS — table (Type · User · Machine result · Scores · Submitted); drawer with scores + Manual
  review / Fail / Pass.
5 CRM — a sales kanban: New · Contacted · Qualified · Closed Won · Closed Lost.
6 USERS — role requests (Approve/Reject); a users table (Phone · Name · Role · Health · Joined · Change role)
  with search + role filter + "Add user".
7 REVENUE — range chips 7d/30d/90d; cards (Revenue, Orders, Avg order value); revenue-per-day area chart;
  by-city + by-type bars; owner-cohorts table.
8 RENT AGREEMENTS — funnel S1–S7 bars; daily trend; by plan/state/status; an agreement-history table + drawer.
9 PG OVERVIEW — supply/demand analytics (bed utilisation, gender mix, top cities, top queries).
10 PG LISTINGS — inventory table (Listing · Owner · Location · Status · Leads 7d) + a detail drawer.
11 FRAUD INTELLIGENCE — a signal feed with severity dots + kind badges (Listing burst / Tenant reports /
   Inactive owner) + Review / dismiss.
12 SYSTEM TOOLS — "Run backfill" (embeddings), "Recompute scores", and a wallet adjustment form (User ID,
   Credits delta, Reason).

Design the shell + the Live Operations, Listing Review (with drawer), and Users tabs in detail; show the
others as the same table/drawer or card/chart pattern. Desktop-first (admins use desktop).
```

---

## 9. FLOW G — Marketing & system pages

```
Build the Cribliv marketing + system pages with the global header/footer. Use the Cribliv UI Kit.

- ABOUT (/about): hero "Making Renting Trustworthy in India"; stats strip (8+ Cities, 100% Owner Verified,
  12hr Refund, 0% Brokerage); "Our Mission"; "What Sets Us Apart" (Trust First / AI-Native / Tenant-First /
  Accessible); "How We Verify Every Owner" (4 steps); CTA "Browse Verified Rentals".
- CONTACT (/contact): hero "We're Here to Help"; 3 channel cards (Email, WhatsApp, Phone — "Mon–Sat 9–7 IST,
  Hindi & English"); support hours; a mini-FAQ; CTA.
- HOW IT WORKS (/how-it-works): "Find Your Home in 3 Simple Steps" (Search Naturally / Verified Owners Only /
  Unlock & Connect, each with bullets); "Your Trust, Our Priority" (100% Verified / 12hr Refund / Zero
  Brokerage / AI-Powered); owner CTA → become-owner.
- PRICING (/pricing): "Simple, Transparent Pricing"; a price card "Contact Unlock ₹49 per property contact"
  (Owner's direct number / 12-hour auto-refund / Zero brokerage forever / Wallet credits never expire);
  a 4-step how-it-works; a "Cribliv vs Traditional Brokers" comparison table; guarantees.
- FAQ (/faq): "Frequently Asked Questions" — 6 accordion categories (Getting Started, Payments & Pricing,
  Refunds & Guarantees, For Property Owners, Safety & Trust, Features & Search); a "Still have questions?" card.
- LEGAL (/privacy, /terms): narrow column, numbered sections, "Last updated" date. (Low design priority.)
- 403 (/403): "Access Denied" — "You're logged in as {phone} ({role})." + "Go to my dashboard" + "Home".
- AUTH ERROR (/auth/error): a titled error message + "Go home" / "Log in".

Design desktop + mobile. These should feel of-a-piece with the home page.
```

---

## 10. Master flow map (the whole graph)

```
PUBLIC ENTRY
  Home ─┬─ Search ──┬─ Listing detail ──(Unlock)──▶ OTP login ──▶ contact revealed
        │           └─ "View on Map" ⇄ CriblMap ──(pin)──▶ Listing detail
        ├─ PG browse ─ PG city ─ PG detail ──(Interest)──▶ login ──▶ "owner will reach out"
        ├─ SEO city/locality/metro/landmark ──▶ Search
        └─ "Post Property" ──▶ Owner dashboard / Become owner

SEEKER ACCOUNT
  login ──▶ Tenant dashboard · Shortlist · Settings   (heart on any listing ──▶ Shortlist)

OWNER
  Become owner ──▶ Owner dashboard ⇄ Listing wizard (6 steps + Maya) ──▶ Verification
                       └─ Leads kanban (New→Contacted→Visit→Deal / Lost)

PG OPERATOR (dark)
  Become ──▶ Onboarding (bed count) ──▶ PG dashboard ⇄ PG wizard (7 steps) ──▶ Listing manage
                       └─ Leads kanban (Reveal contact)

RENT AGREEMENT
  List ──▶ New (plan+language) ──▶ Overview ──▶ Step 1..7 ──▶ Checkout (Razorpay) ──▶ Download PDF

ADMIN (single route, 12 tabs)
  Live Ops · Overview · Listing Review · Verifications · CRM · Users · Revenue · Rent Agreements ·
  PG Overview · PG Listings · Fraud · System Tools
```

---

### Notes for fidelity
- **One coral action per screen.** Everything else is brand blue / neutral.
- **Trust is the brand** — verified badges, "12h auto-refund", "zero brokerage" appear wherever relevant.
- **Two verticals never blur** — Homes show BHK/area/furnishing; PG shows beds/sharing/food/gender.
- **Design empty + loading + error** for any data screen (search, listing, dashboards, leads).
- **Bilingual** — leave headroom for longer Hindi strings.
