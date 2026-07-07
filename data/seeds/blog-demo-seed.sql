-- ─────────────────────────────────────────────────────────────────────────────
-- CRIBLIV TIMES — demo seed (optional, idempotent, removable)
--
-- Inserts a handful of hand-written, PUBLISHED editorial posts so the deployed
-- /blog (Cribliv Times) and the admin Blog Review tab show real content
-- immediately — no AI required. This is DEMO content, not the content engine's
-- output: the generator (Blog Review → "Generate a post") produces the real,
-- data-grounded pieces.
--
-- Safe to run against production:
--   • ON CONFLICT (slug) DO NOTHING — re-running is a no-op, never duplicates.
--   • Only INSERTs into blog_posts; touches nothing else.
--   • Every piece is honest editorial (no fabricated "live data" figures), so it
--     doesn't undermine the data-desk credibility of real generated posts.
--
-- Requires migrations through 0047 (blog_posts) + 0046 (blog_categories seeded).
--
-- Run (one-liner, like the migration):
--   DATABASE_URL="$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')" \
--     psql "$DATABASE_URL" -f data/seeds/blog-demo-seed.sql
--
-- Remove later (when real posts exist):
--   DELETE FROM blog_posts WHERE generated_by = 'manual' AND slug LIKE 'demo-%';
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO blog_posts
  (slug, title, meta_title, meta_description, excerpt, body_en,
   target_keyword, intent, city_slug, category_id, status, generated_by,
   quality_score, faq_items, script, published_at)
VALUES
  (
    'demo-security-deposit-rules-india',
    'Security deposits in India: what the law actually lets a landlord ask for',
    'Security Deposit Rules for Renters in India — Cribliv Times',
    'How much deposit is legal, when it must be returned, and what to do when a landlord withholds it. A plain-English guide for Indian renters.',
    'Most disputes between tenants and landlords are not about rent — they are about the deposit. Here is what the law actually says, and how to protect yours.',
    '<p>Ask any renter in India about their worst tenancy experience and, more often than not, the story ends the same way: at move-out, with a deposit that never fully came back. Rent is agreed in writing; the deposit is where the goodwill quietly disappears.</p>
<p>The good news is that the rules are clearer than most tenants think — and clearest of all under the <strong>Model Tenancy Act</strong>, which several states have adopted or are adapting.</p>
<h2>How much can a landlord ask for?</h2>
<p>Under the Model Tenancy Act the security deposit is capped: up to <strong>two months'' rent for a residential tenancy</strong>, and up to six months'' for commercial. States that have not adopted the Act still tend to follow local convention — one to three months is typical in the metros — but where the Act applies, anything above the cap is not enforceable.</p>
<blockquote>The deposit is security against damage and unpaid dues. It is not a fee, and it is not the landlord''s money to keep by default.</blockquote>
<h2>When must it be returned?</h2>
<p>The deposit is refundable at the end of the tenancy, after the landlord deducts any legitimately owed amounts — unpaid rent, unpaid utility bills, or the cost of repairing damage beyond normal wear and tear. The Model Tenancy Act expects this to happen at handover of vacant possession.</p>
<h2>What counts as a fair deduction?</h2>
<ul>
<li><strong>Fair:</strong> a broken window, a burnt kitchen counter, unpaid electricity dues, a missing appliance that was part of the inventory.</li>
<li><strong>Not fair:</strong> faded paint, minor scuff marks, ordinary wear on fittings, or a blanket "cleaning charge" with no itemisation.</li>
</ul>
<h2>Protect yourself in three steps</h2>
<p>First, get the deposit amount, the rent, and the notice period in a <strong>written agreement</strong> — a verbal understanding is almost impossible to enforce. Second, do a <strong>dated, photographed inventory</strong> of the flat''s condition on the day you move in, and share it with the landlord. Third, at move-out, ask for any deductions <strong>in writing and itemised</strong>. If a landlord withholds the deposit without cause, the rent authority or civil court under your state''s tenancy law is the route to recover it.</p>
<p>None of this is exotic. It is ordinary paperwork — and it is the single most reliable way to make sure the money you handed over on day one comes back to you on the last.</p>',
    'security deposit rules india',
    'informational',
    NULL,
    (SELECT id FROM blog_categories WHERE slug = 'tenancy'),
    'published',
    'manual',
    0.86,
    '[{"q":"How much security deposit is legal in India?","a":"Under the Model Tenancy Act the residential deposit is capped at two months'' rent. States that have not adopted the Act follow local convention, usually one to three months."},{"q":"When should a landlord return the security deposit?","a":"At the end of the tenancy, on handover of vacant possession, after deducting only legitimately owed amounts such as unpaid rent, unpaid utilities, or repair of damage beyond normal wear and tear."},{"q":"Can a landlord keep the deposit for repainting?","a":"Ordinary wear and tear — including faded paint and minor scuffs — is not a valid deduction. Only damage beyond normal use can be charged."}]'::jsonb,
    'en',
    now() - interval '1 day'
  ),
  (
    'demo-model-tenancy-act-explained',
    'The Model Tenancy Act, explained for renters',
    'Model Tenancy Act Explained for Tenants — Cribliv Times',
    'What the Model Tenancy Act changes for renters: written agreements, deposit caps, notice periods, and the rent authority. A clear tenant''s guide.',
    'A written agreement, a deposit cap, and a neutral authority to settle disputes. Here is what the Model Tenancy Act sets out — and why it matters to renters.',
    '<p>For decades, renting in India ran on a patchwork of old state Rent Control Acts and, more often, on informal understanding. The <strong>Model Tenancy Act</strong> is the central government''s template to modernise that — a model law states can adopt to bring rental housing into a clearer, more balanced framework.</p>
<p>It is not automatically the law everywhere: each state has to adopt or adapt it. But it signals the direction of travel, and where it is in force, it changes the tenant''s position for the better.</p>
<h2>Everything in writing</h2>
<p>The Act expects every tenancy to rest on a <strong>written agreement</strong> filed with a district Rent Authority. That single requirement removes the most common source of disputes: disagreement over what was actually agreed.</p>
<h2>A cap on the deposit</h2>
<p>Residential security deposits are capped at <strong>two months'' rent</strong>. This is the change renters feel most directly — it ends the demand for large, arbitrary deposits in the tightest rental markets.</p>
<blockquote>The Act''s core idea is balance: clear obligations for tenants, and clear limits on landlords.</blockquote>
<h2>Notice, entry, and repairs</h2>
<p>The Act sets out <strong>notice periods</strong> for ending a tenancy, requires a landlord to give <strong>advance notice before entering</strong> the premises, and splits responsibility for repairs — structural repairs to the landlord, minor day-to-day upkeep to the tenant.</p>
<h2>A neutral place to settle disputes</h2>
<p>Perhaps the most important piece for renters is the <strong>Rent Authority and Rent Court</strong> structure: a dedicated, faster route to resolve disputes over deposits, eviction, or rent, instead of ordinary civil litigation that can take years.</p>
<h2>What to do with this</h2>
<p>Check whether your state has adopted the Act. Where it has, insist on a written, registered agreement, hold the deposit to the two-month cap, and know that the Rent Authority exists if things go wrong. Where it has not, the same principles — everything in writing, a reasonable deposit, a clear notice period — are still the right things to negotiate for.</p>',
    'model tenancy act explained',
    'informational',
    NULL,
    (SELECT id FROM blog_categories WHERE slug = 'tenancy'),
    'published',
    'manual',
    0.84,
    '[{"q":"Is the Model Tenancy Act law across all of India?","a":"No. It is a central template that each state must adopt or adapt. It is in force only where a state has enacted it."},{"q":"What deposit cap does the Model Tenancy Act set?","a":"Residential security deposits are capped at two months'' rent under the Act."}]'::jsonb,
    'en',
    now() - interval '2 days'
  ),
  (
    'demo-renting-near-amity-noida',
    'Renting near Amity University, Noida: a tenant''s guide',
    'Renting Near Amity University Noida — Areas, Budgets & Tips',
    'Where to live near Amity University in Noida: the sectors students and young professionals pick, what to budget, and what to check before you sign.',
    'Sector 125 sits at the centre of it, but the smart search runs a few sectors wider. A practical guide to renting around Amity, Noida.',
    '<p>Amity University''s main campus sits in <strong>Sector 125</strong>, along the Noida Expressway, and the rental demand around it has a rhythm of its own — it spikes before each academic session and settles between them. If you are searching here, understanding that rhythm is half the job.</p>
<h2>Where people actually live</h2>
<p>Very few tenants live in Sector 125 itself. The practical catchment runs through the neighbouring residential sectors — <strong>126, 127, and the 44/45 belt</strong> — plus the older, more affordable pockets a short auto ride away. The trade-off is the usual one: the closer and newer the society, the higher the rent; a little further out buys more space for the same money.</p>
<h2>What to budget</h2>
<p>Budgets split cleanly by format. A <strong>shared room or PG</strong> is the entry point for most students. A <strong>1BHK or a private studio</strong> suits a working professional or a couple. A <strong>2BHK shared between flatmates</strong> is often the best value per person. Rather than fix a number that dates quickly, check live listings for the exact sector and format before you commit — asking rents move with the season here.</p>
<blockquote>The single biggest lever on your rent near Amity is timing: search in the quiet months, not the week before term starts.</blockquote>
<h2>Getting around</h2>
<p>The Expressway makes the drive into the campus quick, and the Aqua Line metro connects the wider Noida sectors, though the immediate campus stretch leans on autos and buses. If you do not have your own transport, weight your search toward societies with reliable last-mile connectivity.</p>
<h2>Before you sign</h2>
<ul>
<li>Confirm whether the rent is <strong>inclusive of maintenance</strong> or on top of it — society charges add up.</li>
<li>Ask about the <strong>power backup</strong> situation; it is not uniform across sectors.</li>
<li>Get the <strong>deposit and notice period in writing</strong>, and photograph the flat''s condition on move-in day.</li>
<li>For a PG, check the rules on <strong>guests, meals, and timings</strong> before you pay.</li>
</ul>
<p>Amity''s neighbourhood is well-served and genuinely liveable — the tenants who do best here are simply the ones who search a little wider than Sector 125 and time it well.</p>',
    'renting near amity university noida',
    'transactional',
    'noida',
    (SELECT id FROM blog_categories WHERE slug = 'local-guides'),
    'published',
    'manual',
    0.83,
    '[{"q":"Which sectors are best for renting near Amity University, Noida?","a":"Most tenants live in the residential sectors around the Sector 125 campus — 126, 127, and the 44/45 belt — rather than in Sector 125 itself. Older nearby pockets are more affordable."},{"q":"Is it cheaper to rent near Amity outside the peak season?","a":"Yes. Asking rents around the campus rise before each academic session. Searching in the quieter months usually gets you a better deal."}]'::jsonb,
    'en',
    now() - interval '3 days'
  ),
  (
    'demo-checklist-before-signing-rental-agreement',
    'Before you sign: a renter''s checklist for a rental agreement',
    'Rental Agreement Checklist Before Signing — Cribliv Times',
    'The clauses that matter most in a rental agreement — deposit, notice, maintenance, lock-in — and the checks to run before you sign anything.',
    'The excitement of finding the right flat is exactly when tenants skim the agreement. Slow down for ten minutes: here is the checklist that saves the disputes.',
    '<p>You have found the flat, the landlord seems reasonable, and there is a queue of other interested tenants. This is precisely the moment renters make their most expensive mistake — signing the agreement without reading it properly. Ten careful minutes now prevent almost every dispute later.</p>
<h2>The numbers</h2>
<p>Confirm three figures and that they match what you were told verbally: the <strong>monthly rent</strong>, the <strong>security deposit</strong>, and the <strong>annual escalation</strong> (often around 5–10%). If any of these appears different on paper than in conversation, resolve it before signing, not after.</p>
<h2>The exits</h2>
<p>Two clauses govern how you leave. The <strong>notice period</strong> is how much warning either side must give — one month is common. The <strong>lock-in period</strong> is the minimum you are committed to, during which leaving early can forfeit the deposit. Know both numbers before you commit.</p>
<blockquote>Read the exit clauses as carefully as the rent. The cost of a tenancy is not just what you pay to stay — it is what you pay to leave.</blockquote>
<h2>Who pays for what</h2>
<p>The agreement should state clearly who bears <strong>maintenance and society charges</strong>, who handles <strong>repairs</strong> (structural to the landlord, minor upkeep usually to the tenant), and how <strong>utility bills</strong> are settled. Ambiguity here is where move-out arguments begin.</p>
<h2>The paperwork check</h2>
<ul>
<li>Is there a <strong>dated inventory</strong> of fittings and appliances? Photograph everything on move-in day.</li>
<li>Does the deposit-return process spell out <strong>itemised deductions</strong>?</li>
<li>Are both parties'' details and signatures correct, and is the agreement <strong>registered</strong> where your state requires it?</li>
</ul>
<p>A good landlord will not mind a tenant who reads carefully — it signals someone who will treat the property and the agreement seriously. If a landlord pressures you to sign without reading, treat that as information in itself.</p>',
    'rental agreement checklist before signing',
    'informational',
    NULL,
    (SELECT id FROM blog_categories WHERE slug = 'market-updates'),
    'published',
    'manual',
    0.82,
    '[{"q":"What should I check before signing a rental agreement?","a":"Confirm the rent, deposit and annual escalation, read the notice and lock-in periods, clarify who pays maintenance and repairs, and make sure there is a dated inventory of fittings."},{"q":"What is a lock-in period in a rental agreement?","a":"It is the minimum period you are committed to the tenancy. Leaving before it ends can mean forfeiting your deposit, so check it before signing."}]'::jsonb,
    'en',
    now() - interval '4 days'
  )
ON CONFLICT (slug) DO NOTHING;
