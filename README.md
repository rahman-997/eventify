# Eventify

[![CI](https://github.com/rahman-997/eventify/actions/workflows/ci.yml/badge.svg)](https://github.com/rahman-997/eventify/actions/workflows/ci.yml)
[![Security](https://github.com/rahman-997/eventify/actions/workflows/security.yml/badge.svg)](https://github.com/rahman-997/eventify/actions/workflows/security.yml)

![Eventify product preview](https://raw.githubusercontent.com/rahman-997/portfolio/main/public/projects/eventify-cover.jpg)

**A production-oriented event platform built to exercise reliable full-stack system design, not just CRUD.** Eventify combines a React/Vite PWA with an Express 5 + TypeScript API, PostgreSQL/Prisma persistence, Redis-backed caching and rate limits, BullMQ background jobs, durable outbox workflows, operational health checks, metrics, structured logs, and automated security gates.

**Web:** [eventify-web.onrender.com](https://eventify-web.onrender.com) · **API:** [backend2-api.onrender.com](https://backend2-api.onrender.com) · **Health:** [/health](https://backend2-api.onrender.com/health) · **Case study:** [Portfolio](https://abdulrahman-hajjar-dev.netlify.app/work/eventify/) · **Engineer:** [Abdulrahman Hajar](https://github.com/rahman-997)

> Free Render services can require a short wake-up after inactivity.

---

## Engineering snapshot

| Area | Implementation |
| --- | --- |
| API | Express 5 · TypeScript · Zod |
| Data | PostgreSQL · Prisma |
| Shared infrastructure | Redis |
| Background work | BullMQ + durable PostgreSQL outbox |
| Frontend | React · Vite · PWA |
| Authentication | Short-lived access JWT + rotating opaque refresh tokens |
| Security | Argon2id · Helmet · CORS allowlist · Redis-backed throttling · lockout |
| Operations | JSON logs · request IDs · `/health` · `/ready` · `/metrics` |
| Verification | Typecheck · tests · build · architecture rules · audits · Semgrep · CodeQL |

## System architecture

```text
Browser / PWA
     │
     ▼
React + Vite
     │ HTTPS / JSON
     ▼
Express API
  ├─ auth + validation
  ├─ controllers
  ├─ services
  ├─ repositories
  └─ operational middleware
     │                 │
     ▼                 ▼
PostgreSQL           Redis
(authoritative)      cache / rate limits / queue
     │                 │
     └──── Outbox ─────┘
              │
              ▼
          BullMQ worker
```

The API follows:

```text
route → controller → service → repository/data source
```

PostgreSQL is authoritative. Redis is treated as shared ephemeral infrastructure. Booking side effects are written to a PostgreSQL outbox first so a Redis restart cannot silently erase the intent to send a confirmation or promote a waitlisted attendee.

## Core product behavior

### Authentication

- Signup, login, refresh, logout, and current-user flows
- Argon2id password hashing
- Short-lived HS256 access tokens
- Opaque hashed refresh tokens with rotation
- Refresh replay detection and chain revocation
- HttpOnly + Secure + SameSite refresh cookie
- Public signup restricted to attendee accounts

### Events

- Public event search, filtering, and pagination
- Cached list and detail reads
- Organizer ownership boundaries
- Create/update/delete lifecycle rules
- Organizer event statistics
- Capacity guards against invalid destructive changes

### Bookings and waitlists

- Confirmed booking when capacity exists
- Automatic `WAITLISTED` state at capacity
- Cancellation creates durable promotion work
- Worker promotes oldest waitlisted attendees when seats reopen
- Side effects are retried instead of being tied to request lifetime

## Reliability model

### Cache-aside reads

Event lists and detail endpoints use Redis cache-aside behavior with:

- mandatory TTLs
- TTL jitter
- short distributed miss locks
- write invalidation
- PostgreSQL fallback when cache access fails

### Durable async work

BullMQ provides retries and backoff, while PostgreSQL stores the durable intent to enqueue important work. The outbox can redispatch stale attempts and purge delivered rows after retention.

### Operational readiness

```text
GET /health   process liveness
GET /ready    PostgreSQL + Redis readiness and dependency latency
GET /metrics  Prometheus-compatible process/request/cache metrics
```

The worker exposes equivalent health/readiness/metrics endpoints. Every API response includes an `x-request-id` so browser, edge, API, and structured logs can be correlated.

## Security model

- Argon2id password hashing with legacy scrypt migration on successful login
- Strict credentialed CORS allowlist
- Helmet browser hardening
- Redis-backed authentication rate limits
- Per-account lockout behavior
- Server-side event and booking ownership checks
- Structured-log redaction of known credential/token fields
- Production errors do not expose stack traces
- Dependency audits, Semgrep CE, and CodeQL in CI

## PWA delivery

The frontend ships:

- manifest and install icon
- install prompt
- offline fallback
- conservative service worker
- immutable caching for hashed assets
- revalidatable HTML / manifest / service-worker bootstrap
- browser hardening headers including CSP, Referrer Policy, Permissions Policy, and `nosniff`

The service worker deliberately avoids intercepting `/api/*`, keeping authenticated state, availability, and booking mutations network-authoritative.

## Local development

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

Background worker:

```bash
npm run build
npm run worker
```

Frontend:

```bash
cd web
npm install
npm run dev
```

For a zero-cost portfolio deployment, `RUN_WORKER_IN_WEB_SERVICE=true` allows the production launcher to run the API and worker together while keeping the API as the only public listener. A dedicated worker service remains the better topology for higher traffic.

## Verification

```bash
npm run verify:static
npm run verify
npm audit --audit-level=high
cd web && npm run verify && npm audit --audit-level=high
```

`verify:static` runs service-free quality gates including strict API type checking, dependency-cruiser architecture rules, frontend build validation, bundle-budget checks, and PWA verification.

`verify` adds Prisma generation, PostgreSQL/Redis-backed integration tests, and the production backend build.

CI additionally validates migrations, boots the BullMQ worker, probes operational endpoints, runs dependency audits, and executes security analysis.

## Product endpoints

```text
POST /v1/auth/signup
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/auth/me

GET  /v1/events
GET  /v1/events/:id
GET  /v1/events/mine
POST /v1/events
PATCH/DELETE organizer-owned events
GET  /v1/events/:id/stats

POST /v1/bookings
GET  /v1/bookings/mine
GET  /v1/bookings/:id
POST /v1/bookings/:id/cancel
```

## Engineering evidence

- Authoritative relational data model
- Redis as disposable shared infrastructure
- Durable outbox for important async side effects
- Queue retries and exponential backoff
- Cache-aside with failure fallback
- Request correlation
- Structured logging
- Health/readiness separation
- Prometheus-compatible metrics
- Security-focused token lifecycle
- CI-backed architecture, integration, build, audit, and security checks

## Author

Built by **[Abdulrahman Hajar](https://github.com/rahman-997)** — Software Engineer and Full-Stack Developer in Istanbul, Türkiye.

See `CHANGELOG.md`, `AGENTS.md`, `tasks/todo.md`, `docs/security-triage.md`, and `labs/` for deeper implementation history.
