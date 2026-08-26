# Eventify 1.0

[![CI](https://github.com/rahman-997/eventify/actions/workflows/ci.yml/badge.svg)](https://github.com/rahman-997/eventify/actions/workflows/ci.yml)
[![Security](https://github.com/rahman-997/eventify/actions/workflows/security.yml/badge.svg)](https://github.com/rahman-997/eventify/actions/workflows/security.yml)

Eventify is the cumulative Backend Track project evolved into a production-oriented event platform: strict TypeScript, Express 5 + Zod 4, PostgreSQL/Prisma, secure authentication, Redis cache/rate limits, BullMQ background jobs, a React/Vite PWA, operational health checks, request correlation, metrics, and automated security gates.

**Live web app:** [eventify-web.onrender.com](https://eventify-web.onrender.com)  
**Live API:** [backend2-api.onrender.com](https://backend2-api.onrender.com)  
**API health:** [`/health`](https://backend2-api.onrender.com/health)  
**Portfolio case study:** [Eventify engineering case study](https://abdulrahman-hajjar-dev.netlify.app/work/eventify/)

> Free Render services can take a short moment to wake after inactivity.

## Architecture

`route → controller → service → repository/data source`

PostgreSQL is authoritative. Redis is shared ephemeral infrastructure for cache-aside reads, distributed throttling, worker heartbeat, and BullMQ. Booking side effects use a PostgreSQL outbox so a Redis restart cannot silently lose the intent to send a confirmation or promote a waitlisted attendee.

The v1 runtime adds structured JSON logs, request IDs, low-cardinality Prometheus metrics, dependency latency probes, bounded HTTP timeouts, graceful shutdown, Redis connection naming/backoff, cache TTL jitter, outbox retention, worker readiness and queue metrics, plus indexes for the hottest production query paths.

## Fresh clone

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

In another terminal, build and run the background worker:

```bash
npm run build
npm run worker
```

For a zero-cost portfolio deployment, set `RUN_WORKER_IN_WEB_SERVICE=true`.
The production launcher then runs the API and BullMQ worker together while the
API remains the only public listener. Dedicated worker services remain the
recommended topology for higher-traffic production environments.

Frontend:

```bash
cd web
npm install
npm run dev
```

## Operational endpoints

- `GET /health` — process liveness only
- `GET /ready` — PostgreSQL + Redis readiness, dependency latency, and worker-heartbeat visibility
- `GET /metrics` — Prometheus-compatible API process/request/cache metrics
- worker `GET /health` — worker process liveness
- worker `GET /ready` — worker PostgreSQL + Redis readiness
- worker `GET /metrics` — queue state gauges

Every API response includes `x-request-id`; a safe inbound request ID is preserved to correlate browser, edge, API and structured logs.

## Product endpoints

- `POST /v1/auth/signup`, `/login`, `/refresh`, `/logout`; `GET /v1/auth/me`
- `GET /v1/events` — public search/filter/pagination, cache-aside
- `GET /v1/events/:id` — cached public detail
- protected organizer create/update/delete, `/v1/events/mine`, and `/:id/stats`
- `POST /v1/bookings`, `GET /v1/bookings/mine`, item read/cancel

At capacity a new booking becomes `WAITLISTED`. Cancelling a confirmed booking creates a durable promotion job; the worker promotes the oldest waitlisted rows when seats are available. Event lifecycle guards reject past event creation, prevent capacity from dropping below confirmed demand, and block destructive deletion while active bookings remain.

## Security

- Argon2id password hashing; legacy scrypt hashes are migrated on successful login.
- Public signup is an explicit allowlist and always creates `ATTENDEE`.
- 15-minute HS256 access JWTs; opaque hashed refresh tokens rotate on every refresh.
- Refresh replay revokes the replacement chain.
- Access token belongs in memory; refresh token is an HttpOnly + Secure + SameSite cookie.
- Helmet, explicit credentialed CORS allowlists, Redis-backed auth rate limits and per-account lockout.
- Event ownership and booking ownership are enforced server-side.
- Structured logging redacts known credential/token fields and production errors never return stack traces.

## Cache + async jobs

Event lists and details use cache-aside with mandatory TTLs, TTL jitter, short distributed miss locks, and write invalidation. Cache failures fall back to PostgreSQL.

BullMQ jobs use retries with exponential backoff. The durable outbox re-dispatches stale enqueue attempts and purges delivered records after the configured retention period. `EMAIL_MODE=log` is the safe default; set `EMAIL_MODE=smtp` and inject `SMTP_URL` as a secret to deliver real email.

## Installable web app

Eventify Web is a PWA. The production build ships a manifest, install icon, install prompt, offline fallback and service worker. The service worker is deliberately conservative: it caches the public shell and hashed static assets but never intercepts `/api/*`, so authenticated sessions, event availability and booking mutations stay network-authoritative.

The production web server sends long-lived immutable caching for hashed Vite assets while keeping HTML, the manifest and service-worker bootstrap revalidatable. It also adds browser hardening headers including CSP, Referrer Policy, Permissions Policy and `nosniff`.

## Verification

```bash
npm run verify:static
npm run verify
npm audit --audit-level=high
cd web && npm run verify && npm audit --audit-level=high
```

`npm run verify:static` is the service-free local quality gate: it runs strict API type checking, dependency-cruiser architecture rules, and the complete web build, bundle-budget, and PWA checks. `npm run verify` is the full backend gate and additionally requires the configured PostgreSQL and Redis services for Prisma generation, Vitest integration tests, and the production build. CI validates Prisma migrations, boots the BullMQ worker and probes `/health`, `/ready`, and `/metrics`, runs dependency audits, Semgrep CE, and CodeQL.

See `CHANGELOG.md`, `AGENTS.md`, `tasks/todo.md`, `docs/security-triage.md`, and the `labs/` directory for release and course-specific implementation artifacts.
