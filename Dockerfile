# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /app

# Copy workspace manifests first — layer-cached dependency install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json         ./apps/api/
COPY apps/web/package.json         ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/config/package.json  ./packages/config/
COPY packages/ui/package.json      ./packages/ui/

RUN pnpm install --frozen-lockfile

# Copy only what the API compilation needs
COPY apps/api          ./apps/api
COPY packages/shared-types ./packages/shared-types

# Build shared-types first — apps/api/package.json doesn't declare it as a workspace
# dep so turbo's ^build doesn't fire for it. apps/api/tsconfig.json points the
# "@cribliv/shared-types" path to packages/shared-types/dist, which must exist.
RUN pnpm --filter=@cribliv/shared-types build
RUN pnpm turbo build --filter=@cribliv/api

# Create a lean, self-contained production deployment at /deploy.
# pnpm deploy bundles workspace deps (shared-types dist) + prod node_modules only.
RUN pnpm --filter=@cribliv/api deploy --prod /deploy

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /deploy .

# pnpm deploy respects the root .gitignore which lists "dist" — so the package's
# build output is dropped from /deploy. Bring dist/ back explicitly.
COPY --from=builder /app/apps/api/dist ./dist

# shared-types is imported as @cribliv/shared-types at runtime. It's not a
# declared workspace dep in apps/api/package.json, so pnpm deploy doesn't bundle
# it. Drop its built output where Node will resolve it from node_modules.
COPY --from=builder /app/packages/shared-types/dist ./node_modules/@cribliv/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./node_modules/@cribliv/shared-types/package.json

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/main.js"]
