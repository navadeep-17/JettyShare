# JettyShare

**JettyShare** is a mobile-first coastal jetty board for sharing surplus crushed ice and live bait before they spoil. Returning crews can post supply in seconds; departing skippers see the most urgent fresh items first and claim them with one tap.

## Live prototype

**https://jettyshare-navadeep-17s-projects.vercel.app**

## Why this exists

At a small harbor, morning boats often return with ice or bait that will spoil while afternoon boats are trying to source the same supplies. JettyShare replaces word-of-mouth coordination with a tiny, low-bandwidth live board optimized for outdoor mobile use.

## Core flow

`Post surplus → urgency-sorted live board → atomic claim → pickup / release / no-show recovery / collection`

### Features

- Quick post: Ice/Bait, quantity, unit, berth, spoil time
- Live active board ordered by earliest spoil time
- Ice/Bait filters without changing the authoritative board ordering
- Literal one-tap claim after a one-time local boat/crew label
- Atomic database claim so simultaneous claimers cannot both win
- Large pickup berth receipt and spoil countdown
- 15-minute claim hold, capped by the supply spoil deadline
- Automatic no-show reavailability while the supply is still fresh
- Claimant voluntary release and provider release
- Provider-only collection confirmation
- Device-local **My Activity** for posts, claims, and uncertain slow-network recovery
- Copyable text summary for WhatsApp/local messaging groups
- Realtime invalidation plus authoritative refetch and 60-second reconciliation safety net

## Architecture

```text
Mobile browser
   │
   ▼
Next.js / TypeScript
   │
   ├── local crew label + capability secrets
   ├── Quick Post / Live Board / Claim / Activity
   └── Supabase Realtime invalidation
   │
   ▼
Supabase PostgreSQL
   ├── guarded RPC boundary
   ├── private business implementations
   ├── listings state machine
   └── SHA-256 capability digests
```

The browser never receives a service-role key. Direct anonymous table writes are denied. Browser-callable RPCs validate capability tokens and authoritative database time before protected state transitions.

## State model

Stored states are deliberately small:

```text
ACTIVE → CLAIMED → COLLECTED
   ↑        │
   └ release/no-show
```

`EXPIRED` is an **effective state derived from PostgreSQL time**, not a cron-driven stored value. A stale claim whose hold has elapsed is also effectively `ACTIVE` again if the supply has not spoiled.

## Race-condition handling

`claim_listing` locks the target row and decides the winner inside one PostgreSQL transaction. If a valid hold already exists, later claimers receive `CLAIM_UNAVAILABLE`. Every claim generation also carries a UUID `claim_version`; stale claimant/provider screens cannot release or collect a newer claim.

## Slow-3G / uncertain requests

Create and claim IDs/capabilities are persisted in local storage **before** the network request. If the response is lost, retries reuse the same identifiers rather than creating a duplicate. My Activity can reconcile or retry the exact saved attempt.

## No-show handling

A successful claim is held until:

```text
min(claim time + 15 minutes, supply spoil time)
```

When that deadline passes, the same listing becomes visible again if it is still fresh. No paid scheduler or background cron is required.

## Mobile / outdoor design

- 360px-first single-column layout
- system fonts only
- high contrast, explicit text labels, no state encoded by color alone
- 44–48px+ touch targets
- no maps, images, animation frameworks, or other heavy media
- local countdown rendering; no per-second network polling

## Database

The canonical reproducible schema is in:

`supabase/migrations/001_core_schema_and_rpcs.sql`

It includes schema, constraints, indexes, capability tables, lifecycle RPCs, the public/private security boundary, and sanitized Realtime board invalidation.

## Environment contract

JettyShare intentionally has **no checked-in Supabase fallback**. Every environment must provide its database target explicitly so a local or Preview build cannot silently talk to Production.

Required browser-safe variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NEXT_PUBLIC_CANONICAL_APP_URL=http://localhost:3000
```

Only the project URL, publishable key, and canonical public origin belong in `NEXT_PUBLIC_*`. Never place a Supabase secret/service-role key, database password, owner capability, or claim capability in the repository or client environment.

Environment mapping:

- **Local / Vercel Preview:** DEV Supabase project
- **Vercel Production:** PROD Supabase project
- **Production branch:** `main`
- **Production canonical URL:** `https://jettyshare-navadeep-17s-projects.vercel.app`

Changing any `NEXT_PUBLIC_*` value requires a fresh build/deployment because Next.js inlines it into the browser bundle.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill it with **DEV/local** values only.
3. Install from the committed lockfile and start Next.js.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

The app fails fast when either Supabase public variable is missing. That is intentional environment-isolation behavior, not an optional configuration path.

## Quality checks

GitHub Actions validates clean install, production dependency audit, lint, typecheck, unit tests, production build, and release/security preflight checks on the hardening branch/PR and `main`. Browser QA exercises the mobile core flow, recovery behavior, accessibility/design gates, and isolated DEV database behavior before promotion.

## Deliberate trade-offs

JettyShare intentionally does **not** include email/password accounts, OTPs, maps/GPS, chat, payments, ratings, image uploads, or push notifications. For a 30-boat harbor these would add bandwidth, setup friction, and failure modes without improving the core physical handoff. Berth numbers plus existing local messaging groups are enough for v1.

## Tech stack

- Next.js 15 + React 19 + TypeScript
- Supabase PostgreSQL + Realtime
- Vercel
- GitHub Actions
