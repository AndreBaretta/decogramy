# Multi-stage build for the NestJS worker (monorepo workspace).
# Build context is the repo root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npx prisma generate --schema packages/shared/prisma/schema.prisma \
 && npm run build -w @pastatop/shared \
 && npm run build -w @pastatop/worker

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/package.json ./package.json
# The API applies migrations; the worker tolerates a brief startup race and retries.
CMD ["node", "apps/worker/dist/main.js"]
