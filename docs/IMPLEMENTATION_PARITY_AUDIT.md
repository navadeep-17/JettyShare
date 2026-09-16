# JettyShare implementation parity audit — current hardening state

Audit basis: Product & System Specification v1.0, Components 01–10 v1.0, and the current `hardening-spec-parity` implementation. This replaces the original pre-hardening snapshot. A component marked **IMPLEMENTED / PRE-PROD VERIFIED** has its frozen behavior represented in code and covered by the current DEV/Preview evidence, but that does not substitute for the final Component 10 production release gates.

## Parent product specification — IMPLEMENTED / PRE-PROD VERIFIED

The product boundary is intact: public mobile board, quick post, urgency ordering, atomic one-tap claim, device-scoped capabilities, time-derived expiry/no-show, claimant/provider release, provider collection, and complete Copy All summary. Non-goals remain excluded. Final submission remains blocked on Production promotion and Component 10 closure.

## Component 01 — Data model/state machine — IMPLEMENTED / PRE-PROD VERIFIED

- ACTIVE / CLAIMED / COLLECTED persisted lifecycle with time-derived EXPIRED and no-show reopening.
- DB time is authoritative; hold is capped by spoil deadline; EXPIRED wins the boundary.
- Row-lock atomic claim arbitration, claim generation/version guards, idempotent winning retry, stale-generation rejection, provider release and collection.
- `numeric(8,2)` quantity precision and normalized-label constraints.
- Capability hashes are outside the public listing surface; direct anonymous DML is denied.
- Repeatable DEV database QA includes exact 10-client contention, wrong-capability denial, no-show/expiry timing fixtures and public API checks.

Final PROD verification is still required after the API-boundary cutover.

## Component 02 — Identity/trust/authorization — IMPLEMENTED / PRE-PROD VERIFIED

- Public browsing; first mutation requests a local boat/crew label.
- Label trim/collapse/control-character validation is implemented client and server side.
- Web Crypto 32-byte base64url capabilities and UUID claim generations are persisted before mutation.
- Versioned localStorage keys, storage probe, same-device attempt recovery, and no label-based authority.
- Profile label can be changed for future mutations without transferring authority.
- Same label on another browser/device has no capability authority.

## Component 03 — Quick Post — IMPLEMENTED / PRE-PROD VERIFIED

- ICE/BAIT, contextual units, positive quantity up to two decimals, berth 1–12, no default spoil time, presets plus 5–360 custom minutes.
- Inline associated errors, first-invalid focus, keyboard path, immutable persisted attempt and exact retry.
- Offline/slow-network ambiguity preserves the pending action and never reports false success.
- Double-submit protection and typed safe user errors are covered by browser QA.

## Component 04 — Live Board — IMPLEMENTED / PRE-PROD VERIFIED

- Authoritative effective-active snapshot ordered by expiry/creation/id and locally filtered All/Ice/Bait.
- Frozen URGENT/SOON/AVAILABLE bands and conservative countdown formatting use a server/device clock offset.
- One shared clock; snapshot loads independently of Realtime.
- Realtime is invalidation only; SUBSCRIBED refetch, focus/visibility recovery, 60-second visible fallback, next-transition reconciliation, 5/15/30-second read retry and stale-response suppression are implemented.
- Initial and background failure states remain truthful and retain last-good data appropriately.

## Component 05 — Claim — IMPLEMENTED / PRE-PROD VERIFIED

- Literal repeat-user one-tap claim; first-use Save & Claim resumes the original target.
- No preflight listing read before the atomic claim RPC.
- Persist-before-request and same-generation retry semantics survive slow/lost responses.
- Authoritative receipt includes item/quantity/unit, berth, provider label, claimant label, hold deadline, spoil deadline and server time.
- Pending ambiguity enters verifying behavior and resumes on focus/reconnect without manufacturing a new claim generation.
- Two-browser visible contention and exact 10-client database contention are both verified.

## Component 06 — No-show/release/collection — IMPLEMENTED / PRE-PROD VERIFIED

- No-show remains time-derived and requires no cron/write to reopen a fresh listing.
- My Activity reconciles protected provider and claimant state before destructive actions.
- Separate hold/spoil deadlines, HOLD ENDING SOON guidance, confirmation before release/collection, uncertain CHECKING state, focus-after-sleep reconciliation and terminal capability cleanup are implemented.

## Component 07 — Copy Summary — IMPLEMENTED / PRE-PROD VERIFIED

- Copy All uses the complete authoritative active board rather than the current visual filter.
- Remaining time is conservative; under one minute is explicit.
- Healthy recent snapshots copy locally; stale/degraded state requires authoritative refresh or an explicitly labelled last-known fallback.
- Copy attempts are locked; success includes item count; clipboard denial provides selectable manual fallback.
- Provider labels, claim details and capability material are excluded.
- Deployed Preview tests verify the actual deployment origin is used and query/hash fragments are stripped.

## Component 08 — Mobile design system — IMPLEMENTED / PRE-PROD VERIFIED

- High-glare light-only, system-font, centered one-column mobile shell with frozen semantic styling and focus treatment.
- Persistent labels, associated validation, >=44/48px primary targets, sheet focus movement/trap/restore, reduced-motion handling and textual/non-color-only status meaning.
- Automated evidence covers 320px, 360px and 200% reflow proxy, no horizontal overflow, contrast checks, keyboard activation and receipt hierarchy.

A physical-device observation may still be recorded as supplementary evidence, but no known P0/P1 implementation gap remains in the tested paths.

## Component 09 — Deployment/security — IMPLEMENTED / PRE-PROD VERIFIED, PROD CUTOVER PENDING

- Public GitHub repository with deterministic lockfile and CI gates for high/critical production dependency advisories, release-security preflight, lint, typecheck, tests and build.
- Local/Preview do not default to PROD; Vercel environment values are explicitly separated.
- `main` is the sole Production branch; non-main branch receives Preview deployment.
- Security headers/CSP are configured; browser runtime uses publishable key only.
- DEV uses the explicit exposed `api` schema with private business implementations and direct table/private API access closed.
- Git-backed Preview is publicly reachable for QA and is proven to use DEV, not PROD.
- Production has no test seed.

The legacy PROD database has safely received the forward constraint and receipt/retry hardening. The final `api`-schema boundary is intentionally deferred to the coordinated cutover because applying it before the hardened frontend deploy would break the legacy Production client.

## Component 10 — Integrated QA/submission — IN PROGRESS

Pre-production evidence now includes deterministic CI, DEV database contract checks, exact 10-client contention, exact-commit Vercel Preview isolation, and a **48/48** deployed-Preview browser run on the tested release candidate. The suite covers the principal race, lost-response, slow-network, Realtime recovery, mobile/accessibility, lifecycle and Copy Summary release paths.

Still not green until Production release evidence is recorded: PROD API-boundary migration, merge/deploy from `main`, public/incognito + independent second-device production walkthrough, production direct-DML/private-surface checks, exact final deployed SHA, public repo/README/submission-link verification, <=300-word tradeoff-note truth audit, no open P0/P1 blockers, staging-form link verification, and only then QA-28 submission.

## Current stop-ship list

1. Complete coordinated PROD API-boundary cutover and `main` deployment.
2. Verify the exact Production deployment SHA and public stable origin.
3. Run final Production security + two-device/browser acceptance checks.
4. Close the remaining Component 10 documentation/submission gates and truth-audit the tradeoff note.

Until those items are green, JettyShare is **not submission-ready**.
