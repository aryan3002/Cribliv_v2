# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /app

# Copy workspace manifests first — layer-cached dependency install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/api/package.json         ./apps/api/
COPY apps/web/package.json         ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/config/package.json  ./packages/config/
COPY packages/ui/package.json      ./packages/ui/

RUN pnpm install --frozen-lockfile

# Copy only what the API compilation needs
COPY apps/api          ./apps/api
COPY packages/shared-types ./packages/shared-types

# turbo resolves ^build order: shared-types → api
RUN pnpm turbo build --filter=@cribliv/api

# Create a lean, self-contained production deployment at /deploy.
# pnpm deploy bundles workspace deps (shared-types dist) + prod node_modules only.
RUN pnpm --filter=@cribliv/api deploy --prod /deploy

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/main.js"]
