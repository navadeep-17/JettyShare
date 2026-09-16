# JettyShare

**JettyShare** is a mobile-first coastal jetty board for sharing surplus crushed ice and live bait before they spoil. Returning crews can post supply in seconds; departing skippers see the most urgent fresh items first and claim them with one tap.

## Live prototype

**https://jettyshare.vercel.app**

## Why this exists

At a small harbor, morning boats often return with ice or bait that will spoil while afternoon boats are trying to source the same supplies. JettyShare replaces word-of-mouth coordination with a tiny, low-bandwidth live board optimized for outdoor mobile use.

## Core flow

`Post surplus → urgency-sorted live board → atomic claim → claim-bound pickup verification → collection / release / no-show recovery`

### Features

- Quick post: Ice/Bait, quantity, unit, berth, spoil time
- Live active board ordered by earliest spoil time
- Ice/Bait filters without changing the authoritative board ordering
- Literal one-tap claim after a one-time local boat/crew label
- Atomic database claim so simultaneous claimers cannot both win
- Large pickup berth receipt with separate hold and spoil deadlines
- Four-digit pickup code bound to the current claim capability
- Provider-side pickup verification before terminal collection
- 15-minute claim hold, capped by the supply spoil deadline
- Automatic no-show reavailability while the supply is still fresh
- Claimant voluntary release and provider release
- Device-local **My Activity** for posts, claims, pickup-code recovery, and uncertain slow-network recovery
- Copyable text summary for WhatsApp/local messaging groups
- Realtime invalidation plus authoritative refetch and 60-second reconciliation safety net

## Trust model

A boat/crew label is deliberately **not verified identity**. It is a local coordination label so crews know what to call each other. Protected record actions instead use random device-held capability tokens, with only SHA-256 digests stored in PostgreSQL.

Pickup Verification connects that digital authority to the physical handoff. Each current claim exposes a four-digit code only to the claimant session that controls the claim capability. At the berth, the provider enters that code using the provider's owner capability. Verification proves that the person present can access the browser/session controlling the **current claim generation**; it does not verify a legal identity, phone number, vessel registration, or ownership of the crew label.

`confirm_collected` checks the pickup code again in PostgreSQL, so the UI cannot bypass the handoff proof. Release, no-show, expiry, or a newer claim generation makes the old claim proof unusable.

## Architecture

```text
Mobile browser
   │
   ▼
Next.js / TypeScript
   │
   ├── local crew label + capability secrets
   ├── Quick Post / Live Board / Claim / Activity / Pickup Verification
   └── Supabase Realtime invalidation
   │
   ▼
Supabase PostgreSQL
   ├── exposed api.* RPC wrappers
   ├── private.* guarded business implementations
   ├── public listings state machine
   └── private SHA-256 capability digests
```

The browser never receives a service-role key. Direct anonymous table writes are denied. The browser calls only the narrow `api` RPC surface; guarded private implementations validate capability tokens, expected claim versions, pickup proof where required, and authoritative database time before protected state transitions.

## State model

Stored states are deliberately small:

```text
ACTIVE → CLAIMED → COLLECTED
   ↑        │
   └ release/no-show
```

`EXPIRED` is an **effective state derived from PostgreSQL time**, not a cron-driven stored value. A stale claim whose hold has elapsed is also effectively `ACTIVE` again if the supply has not spoiled.

## Race-condition handling

`claim_listing` locks the target row and decides the winner inside one PostgreSQL transaction. If a valid hold already exists, later claimers receive `CLAIM_UNAVAILABLE`. Every claim generation also carries a UUID `claim_version`; stale claimant/provider screens cannot release, verify, or collect a newer claim.

## Pickup verification

The four-digit pickup code is derived from the SHA-256 digest of the current random claim capability rather than stored as another database secret. Claim-authorized responses can return it to the claimant; the public board and provider read model cannot.

The provider's verification RPC requires all of the following at once:

- the original provider's owner capability,
- the exact current `claim_version`,
- a live claim hold on an unexpired listing,
- the matching four-digit pickup code.

A successful verification enables the provider's collection action, but PostgreSQL validates the same code again inside `confirm_collected` before the terminal `COLLECTED` transition.

## Slow-3G / uncertain requests

Create and claim IDs/capabilities are persisted in local storage **before** the network request. If the response is lost, retries reuse the same identifiers rather than creating a duplicate. My Activity can reconcile or retry the exact saved attempt. Network uncertainty during pickup verification does not discard either party's capability.

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
- local countdown rendering from a server-adjusted clock; no per-second network polling

## Database

The reproducible database contract is versioned in `supabase/migrations/`.

It includes the schema, constraints, indexes, capability tables, lifecycle functions, explicit `api`/`private` Data API boundary, sanitized Realtime board invalidation, and Pickup Verification v1.1. Migrations `008_pickup_verification_bridge.sql` and `009_finalize_pickup_verification.sql` add the claim-bound pickup proof using a zero-downtime bridge before removing the legacy collection RPC. Production is promoted only through committed forward migrations; fake/demo seed data is never part of the production release path.

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
- **Production canonical URL:** `https://jettyshare.vercel.app`

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

GitHub Actions validates clean install, production dependency audit, release/security preflight, lint, typecheck, unit tests, production build, database contract checks, and mobile browser QA before promotion. The Git-backed Vercel Preview is verified against its exact Git SHA and must point to the isolated DEV Supabase project before production cutover.

## Deliberate trade-offs

JettyShare intentionally does **not** include email/password accounts, phone verification, OTPs, maps/GPS, chat, payments, ratings, image uploads, or push notifications. For a 30-boat harbor these would add bandwidth, setup friction, and failure modes without improving the core physical handoff. The four-digit pickup proof verifies possession of the current claim session at handover without turning JettyShare into an identity platform.

## Tech stack

- Next.js 15 + React 19 + TypeScript
- Supabase PostgreSQL + Realtime
- Vercel
- GitHub Actions
