# JettyShare DEV / Preview QA evidence

This file records the verified pre-production release evidence for the isolated `JettyShare-DEV` stack. It is not a submission declaration; final PROD promotion and Component 10 production gates remain outstanding.

## Environment isolation

- DEV Supabase project: `JettyShare-DEV` (`ysexholoqrxyuqhmrkuq`, `ap-south-1`).
- PROD Supabase project: `bxqumvatvqhvqdngrklk`.
- Vercel project: `jettyshare`, connected to `navadeep-17/JettyShare`.
- Vercel Production branch: `main` only.
- Stable Production domain: `https://jettyshare.vercel.app`.
- Preview and Development use DEV Supabase; Production uses PROD Supabase.
- Preview diagnostics are unavailable in Production by design.

## DEV migrations

The isolated DEV project has the complete current migration set:

1. `001_core_schema_and_rpcs`
2. `002_spec_parity_constraints`
3. `003_claim_receipt_and_retry_contract`
4. `004_api_schema_boundary`
5. `005_reload_postgrest_api_schema`

The production project predates the reproducible DEV bootstrap. Its legacy baseline is retained; the safe forward hardening equivalents for the constraint and receipt/retry contracts have now been applied. The API-boundary cutover remains intentionally blocked until the final merge/deploy step because applying it earlier would break the currently deployed legacy frontend.

## Database evidence

- Rollback-only state-machine suite: PASS.
- Timing / no-show / stale-generation suite: PASS.
- Public-client Data API + exact 10-client claim race: PASS.
- Exactly one of ten simultaneous first claims wins; nine lose with `CLAIM_UNAVAILABLE`.
- Winning retry with the same claim version/token is idempotent and does not extend the hold.
- Wrong capabilities are rejected.
- Direct anonymous table mutations are denied.
- Private capability data/private implementation routines are not exposed through the browser Data API.
- Relative-time fixtures verify urgency order, no-show reopening while fresh, and spoil/expiry exclusion.

## Exact Vercel Preview evidence

Branch Preview:
`https://jettyshare-git-hardening-spec-parity-navadeep-17s-projects.vercel.app`

The Preview workflow waits until `/diagnostics` reports the exact Git SHA under test, then proves:

- runtime is `preview`;
- Supabase host is `ysexholoqrxyuqhmrkuq.supabase.co`;
- PROD host `bxqumvatvqhvqdngrklk.supabase.co` is absent;
- publishable-key contents are not rendered.

A production-like Chromium suite then runs against that deployed Preview origin. On tested head `c641e2347949e85f31f5cf19a699ca74f4d37ff2`, the deployed Preview suite passed **48/48**. It covers post, atomic claim contention, claim ambiguity recovery, release/reclaim/collect, lost-response retries, slow-network behavior, Realtime/focus recovery, 320/360px layout, 200% reflow proxy, focus/modal behavior, contrast semantics, clipboard normal/manual-fallback paths, filter-independent Copy All, and deployed-origin canonicalization.

The same head also passes CI (dependency high/critical gate, security preflight, lint, typecheck, unit tests, build), DEV public-contract/10-client DB QA, and the local DEV browser suite.

## Remaining release gates

Production API-boundary migration, merge/deployment from `main`, exact deployed-SHA verification, public Production incognito/second-device QA, PROD security checks, final README/submission-note truth audit, and Component 10 QA-01..QA-28 closure remain required before submission.
