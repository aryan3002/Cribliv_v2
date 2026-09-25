# Frontend: Vercel → Azure Container Apps (2026-09-25)

Backend already moved (see `2026-09-13-azure-subscription-migration-runbook.md`).
This moves the Next.js web app. **Not cut over — nothing points at Azure yet.**

|          | Now (live)                         | Target                                         |
| -------- | ---------------------------------- | ---------------------------------------------- |
| Serving  | Vercel (`cribliv-v2-web`)          | `cribliv-web` container app, RG `cribliv-prod` |
| URL      | cribliv.com (GoDaddy DNS → Vercel) | same domain, DNS → Azure                       |
| Replicas | Vercel-managed                     | **exactly 1** (see ISR note)                   |

## Built and verified (2026-09-25)

`https://cribliv-web.greenflower-1ce3f92d.centralindia.azurecontainerapps.io` — 1 replica, 1 vCPU / 2 GiB, port 3000.

- [x] `Dockerfile.web`, `output: "standalone"`, `.dockerignore` fix — PR #155 (draft)
- [x] Image `cribliv-web:0f93458-20260925101049` built in ACR with real build args (9m48s)
- [x] Pages 200: `/en`, `/hi`, `/en/blog`, `/en/search`, `/en/about`, `/en/city/lucknow`, article + listing detail, 404 behaves
- [x] SSR works against the new API: 20 listings rendered, photos from `criblivphotos`, CSP shows the `greenflower` API host
- [x] `content/`-backed routes OK (`/llms.txt`, `/.well-known/agent-skills/index.json`, `/docs/api`) — these justify the `apps/web/content` COPY
- [x] **Sitemap parity**: `/sitemap.xml` 404s on _both_ hosts (by design — sitemaps are chunked). `/sitemap/0.xml` + `/sitemap/1.xml` byte-identical on Vercel and Azure (16,773b / 75,333b)
- [x] Runtime env set; `AUTH_SECRET`/`NEXTAUTH_SECRET` wired from a Key-Vault-free local source, `AUTH_TRUST_HOST=true`

### Performance — measured from a US machine, so distance-biased

|                      | connect | tls    | ttfb   | render ≈ ttfb−tls |
| -------------------- | ------- | ------ | ------ | ----------------- |
| Azure (centralindia) | 244 ms  | 510 ms | 811 ms | **~300 ms**       |
| Vercel (nearby edge) | 8 ms    | 59 ms  | 264 ms | **~205 ms**       |

Render times are comparable; the headline gap is the US→India hop, which an Indian user does not pay.
**Re-measure from India before judging.** Vercel's SSR also pays a cross-region hop to the API that Azure does not.

## Env handling

`NEXT_PUBLIC_*` are compiled into the client bundle → **build args**, not runtime env. 19 of 20 were recovered without
Vercel (the bundle itself, plus `apps/web/.env.local`); the 20th, `NEXT_PUBLIC_CLARITY_ID`, is **unset in production**
(no `clarity.ms` in the live bundle; the component returns null without it).

14 Vercel vars are marked _Sensitive_ and cannot be read back by anyone, including the owner.
Server-only ones still needed at cutover: `AUTH_SECRET` / `NEXTAUTH_SECRET`, `POSTHOG_API_KEY`.

## Before cutover

- [ ] **CORS**: add the web origin to the API's `CORS_ALLOWED_ORIGINS` (currently cribliv.com, www, the Vercel URL, localhost).
      Without it, browser-side API calls from the Azure host fail. Additive but restarts the API revision.
- [ ] **DNS TTL** (owner, GoDaddy — no API access from here): `@` A record 1800 → 600, `www` CNAME 3600 → 600, at least an hour ahead.
- [ ] **CI**: add a web build+deploy job. The 19 build args must become GitHub secrets/vars first.
- [ ] Decide previews: Azure has no PR-preview equivalent — simplest is to keep the Vercel project for previews only.
- [ ] Custom domain + managed cert on the container app (TXT `asuid` verification), then the DNS switch.

## Cutover shape (differs from the backend move)

**No write freeze, no downtime.** Both stacks can serve simultaneously during propagation — same API, same DB, stateless
frontend. Switch = DNS at GoDaddy. Rollback = point DNS back at Vercel (fast once TTL is lowered).

Sessions: the session cookie (`cribliv.session-token`) pins **no domain**, so it carries across on the same hostname —
sessions survive **iff** the `AUTH_SECRET` used on Azure matches Vercel's. Worst case is one forced re-login, and
`session.maxAge` is 24h anyway.

## Known trade-offs after the move

- On-demand cache invalidation (`/api/revalidate`, used when publishing a Times story) is **per-replica** off Vercel → keep 1 replica.
- `next/image` optimisation runs in-container (CPU) instead of at Vercel's edge.
- No global CDN unless Front Door is added; fine for India-centric traffic.
- Vercel Analytics stops; PostHog continues (Clarity is already inactive).
