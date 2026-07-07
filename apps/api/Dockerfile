# Multi-stage build for the NestJS API (monorepo workspace).
# Build context is the repo root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install deps using the lockfile + all workspace manifests (better cache).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

# Build shared (incl. Prisma client) and the API.
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npx prisma generate --schema packages/shared/prisma/schema.prisma \
 && npm run build -w @pastatop/shared \
 && npm run build -w @pastatop/api

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
# Apply migrations then start the API (idempotent; safe to run every boot).
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/shared/prisma/schema.prisma && node apps/api/dist/main.js"]
