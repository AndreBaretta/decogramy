# Decogramy — photo social network for a distributed systems demo

Decogramy is a small photo-only social network made for a distributed systems final project.
The app itself is simple on purpose: users can upload photos, follow each other, like posts,
see feeds and receive notifications. The interesting part is how the backend handles work
outside the request path using an outbox table, RabbitMQ, a worker process, Redis Pub/Sub and
Server-Sent Events.

PostgreSQL is the source of truth. Work that does not need to block the user, such as thumbnail
generation, cleanup and live notification delivery, run asynchronously.

See [`architecture.md`](./architecture.md) for the full design.

## What is implemented

- Auth: register / login, Argon2id password hashing, JWT access tokens.
- Upload pipeline: API creates a post + signed PUT URL → browser uploads straight to
  object storage → finalize publishes the post and writes outbox events.
- Async worker: outbox publisher (Postgres → RabbitMQ with publisher confirms),
  thumbnail generation with Sharp, notification fan-out, object cleanup, upload-expiry scanner.
- Social: home feed (followees + self) and explore, both cursor-paginated; profile grid;
  follow / unfollow; likes with transactional counts.
- Notifications: durable rows written in the originating transaction; live delivery over
  SSE bridged by Redis Pub/Sub so it works across multiple API instances.
- Failure handling: Redis cache + fixed-window rate limiting that fail open; automatic RabbitMQ
  reconnect; retry tiers (10s → 30s → 2m) and a dead-letter queue.
- Web: React + Vite client (auth, feed, explore, upload with live pipeline view, profile
  grid, live notifications).

## Architecture at a glance

```
Browser ──REST+JWT──▶ API (NestJS) ──tx──▶ PostgreSQL (source of truth)
   │  ▲                 │  writes outbox_events in the SAME tx
   │  │ SSE             ▼
   │  └──────────── Redis Pub/Sub ◀── Worker publishes live notifications
   │                                    ▲
   └──signed PUT──▶ MinIO (R2/CDN)      │
                        ▲               │
   Worker (NestJS) ─────┘  polls outbox (FOR UPDATE SKIP LOCKED)
        └─ publishes to RabbitMQ (confirms) ─▶ consumers:
             • thumbnail  (Sharp, 400×400 webp)
             • notifications (→ Redis Pub/Sub)
             • cleanup   (delete objects on post.deleted)
           idempotency via processed_events; retry tiers + DLQ
```

## Prerequisites

- Docker + Docker Compose
- Node.js 20+ (only needed to run the web dev server or the apps outside Docker)

## Run the whole stack (Docker)

```bash
cp .env.example .env
# If a local Postgres already uses 5432, set POSTGRES_HOST_PORT=5433 in .env
# (and update DATABASE_URL's port to match).

docker compose up -d --build
```

This starts PostgreSQL, Redis, RabbitMQ, MinIO, the API and the worker. The API applies
Prisma migrations on boot. Then run the web client:

```bash
npm install
npm run dev:web        # http://localhost:5173  (talks to the API on :3000)
```

Useful endpoints/UIs:

| Service            | URL                                            |
| ------------------ | ---------------------------------------------- |
| Web app            | http://localhost:5173                          |
| API                | http://localhost:3000  (health: `/health`)     |
| RabbitMQ mgmt UI   | http://localhost:15672  (pastatop / pastatop)  |
| MinIO console      | http://localhost:9001   (pastatop / pastatoppastatop) |

## Run apps outside Docker (dev)

Start only the infra in Docker, run API + worker with hot reload:

```bash
docker compose up -d postgres redis rabbitmq minio minio-init
npm install
npm run prisma:generate
npm run prisma:migrate      # first time only, creates the schema
npm run dev                 # api + worker with ts-node-dev
npm run dev:web             # web client
```

## Demo script (for the presentation)

1. Register two users (Alice, Bob) in two browser tabs.
2. Alice uploads a photo. The Upload screen shows the pipeline live:
   create post → signed PUT to storage → finalize/publish → worker generates the thumbnail
   asynchronously. Watch the thumbnail appear on Alice's profile grid a moment later.
3. Bob follows Alice, sees her post in his home feed, and likes it.
4. Alice gets a live notification (SSE badge increments instantly) — even though the like
   traveled Postgres → outbox → RabbitMQ → worker → Redis Pub/Sub → SSE.

### Failure demo

Stop RabbitMQ during the demo and show that the app still accepts the main actions:

```bash
docker compose stop rabbitmq
# In the UI: like posts / upload. The API still returns 200 and commits to Postgres.
# The events pile up as `pending` in the outbox instead of being lost:
docker exec pastatop-postgres-1 psql -U pastatop -d pastatop \
  -c "SELECT \"eventType\", status FROM outbox_events WHERE status='pending';"

docker compose start rabbitmq
# The worker reconnects, re-asserts the topology, drains the backlog, and the
# delayed notifications are delivered. Nothing was lost.
```

You can do the same with the worker (`docker compose stop worker`). Likes and uploads keep
working; thumbnails and live notifications catch up when the worker returns.

## Repository layout

```
apps/
  api/      NestJS HTTP API + SSE endpoints
  worker/   NestJS worker: outbox publisher, RabbitMQ consumers, Sharp, scanner
  web/      React + Vite client
packages/
  shared/   Prisma schema/client + shared event contracts
docker-compose.yml
```

## Distributed-systems points to mention

- Transactional outbox: `outbox_events` is written in the same DB transaction as the
  business change (`apps/api/src/common/outbox.service.ts`). That avoids losing events or
  publishing events for rolled-back changes. Relayed by `apps/worker/src/outbox/outbox-publisher.service.ts`
  using `FOR UPDATE SKIP LOCKED` (safe for multiple worker replicas) + publisher confirms.
- Idempotent consumers: `processed_events (event_id, handler_name)` guards every handler
  against RabbitMQ's at-least-once redelivery (`apps/worker/src/idempotency`).
- Retry + DLQ: failed handlers are re-published to delay tiers (10s/30s/2m) and then to a
  dead-letter queue (`apps/worker/src/rabbit`).
- Live fan-out across instances: the worker publishes to Redis Pub/Sub and every API
  instance forwards to its connected SSE clients, so it scales horizontally.
- Failure tolerance: Redis cache/rate-limit fail open; RabbitMQ/worker outages delay
  side effects without failing user actions.

> Note on Cloudflare mapping: MinIO stands in for Cloudflare R2, and its public object URLs
> represent the CDN-served media path. There is no production deployment — the Docker Compose
> setup is the environment used for the presentation.
