# JettyShare implementation parity audit

Audit basis: Product & System Specification v1.0, Components 01-10 v1.0, and the implementation playbook/progress log. Status is based on the current `main` implementation before hardening.

Legend: **PASS** = implemented and verified enough to retain; **UNVERIFIED** = code exists but required evidence is missing; **PARTIAL** = important parts exist but contract differs; **MISSING** = required planned behavior/configuration is absent.

## Parent product specification — PARTIAL

The core product boundary is present: public board, quick post, atomic claim, device capabilities, no-show semantics, provider collection, copy summary, free Vercel/Supabase deployment. The parent submission gate is not satisfied because Components 01-10 are not yet fully verified and known P0/P1 parity gaps remain.

## Component 01 — Data model/state machine — PARTIAL

PASS: ACTIVE/CLAIMED/COLLECTED stored model; time-derived EXPIRED; stale hold becomes effectively ACTIVE while fresh; 15-minute hold capped by spoil; row-lock claim arbitration; version/token stale-generation guards; provider release/collection; no cron; capability hashes separated from public listings; direct anon table DML denied; sanitized board snapshot.

Gaps: schema uses unconstrained `numeric` rather than frozen `numeric(8,2)`; the repository has no repeatable automated DB-01..DB-24 integration suite; exact 10-client race/idempotent-lost-response evidence is not checked into the release suite. C09 deployment-layer RPC boundary also differs from the later frozen `api/private` model.

## Component 02 — Identity/trust/authorization — PARTIAL

PASS: public browse; first-mutation label; 32-byte Web Crypto capabilities; UUID claim versions; versioned localStorage keys; persist-before-request; SHA-256 at rest; no label-based authority; no service-role browser key.

Gaps: crew label only trims; it does not collapse repeated internal whitespace or reject control characters as frozen. There is no user-visible Change-label path for future mutations. Same-device simultaneous tabs can race while creating a new claim generation and overwrite the shared local claim record. AUTH-01..25 are not represented as a repeatable automated/manual evidence matrix.

## Component 03 — Quick Post — PARTIAL (close)

PASS: compact single sheet; ICE/BAIT; contextual units; quantity/berth/spoil validation; no default spoil time; 15/30/60/120 + custom 5-360; listing ID + owner capability persisted before RPC; exact retry record retained; no edit/media/contact fields.

Gaps: profile context/change path is missing; label normalization inherits C02 gap; ambiguous/slow-3G acceptance evidence is incomplete; QP-01..26 are not automated/recorded; server-side persisted schema precision differs from C01.

## Component 04 — Live Board — PARTIAL

PASS: public snapshot; effective-ACTIVE membership; urgency DB ordering; local All/Ice/Bait filters; Realtime Broadcast invalidates then refetches; debounce; request-generation stale-response guard; next-transition timer; 60-second visible safety refresh; focus/visibility refresh; own-post detection.

Gaps: `server_now` is returned but not used for a device/server clock offset; countdown and transition scheduling use raw device `Date.now()`. Each card owns a separate one-second interval instead of one shared board clock. Frozen URGENT/SOON/AVAILABLE text bands and under-10-minute `m:ss` formatting are not implemented. Initial snapshot failure is presented as an empty board rather than load-error + Retry. Own-post Claim remains rendered disabled instead of absent. Semantic-list/focus behavior is incomplete.

## Component 05 — Claim — PARTIAL

PASS: repeat-user literal one-tap claim; first-use Save & Claim; persist-before-request; direct atomic RPC (no preflight); retry same version/token with 750ms/2s backoff; typed race/expiry outcomes; success receipt; board refresh; claim release capability.

Gaps: receipt omits provider label; hold and spoil deadlines are not separately counted down; receipt does not become stale/reconcile automatically at the hold boundary; unresolved pending claim is not automatically resumed on reconnect/focus; multi-tab unresolved-attempt race is unsafe; full CL-01..30 evidence is absent, including required automated 10-client race and simulated lost-success retry preserving original hold.

## Component 06 — No-show/release/collection — PARTIAL

PASS: claimant release; provider release bound to expected claim version; provider-only collection; late/stale server rejection; time-derived no-show; My Activity; capability cleanup after terminal/stale reconciliation; board refresh after mutations.

Gaps: destructive claimant/provider release confirmations are missing; collection confirmation is missing; provider My Activity lacks hold/spoil countdowns, `HOLD ENDING SOON`, and `Confirm before` deadline guidance; ambiguous lifecycle mutations do not consistently enter a CHECKING/disabled reconciliation state; focus after sleeping past a deadline is not explicitly reconciled before controls remain actionable. NR-01..30 evidence is incomplete.

## Component 07 — Copy Summary — PARTIAL

PASS: complete authoritative snapshot (not current visual filter); no poster labels/private data; board order retained; stale/degraded board triggers refresh; clipboard fallback exists.

Gaps: remaining time rounds up instead of conservatively down and does not use server-adjusted time; `<60s` does not say `under 1 min left`; production canonical URL is not read from the frozen deployment variable; an empty board still produces a normal current summary even though the frozen interaction state is UNAVAILABLE; failed refresh immediately opens last-known text instead of requiring an explicit user choice; last-known format/age differs; repeated copy taps are not locked; success feedback omits item count. CS-01..28 evidence is incomplete.

## Component 08 — Mobile design system — PARTIAL

PASS: one-column max-width shell; 360px-first layout; system fonts; >=44/48px controls in most core paths; bottom sheets; safe-area padding; textual status/error messages; no bitmap core media/webfonts; focus-visible ring.

Gaps: palette and typography do not match the frozen semantic tokens; light `color-scheme` is not declared; dialog focus is not deliberately moved/restored; field errors are not associated to individual fields; hold/spoil distinction and several specified semantic states are missing; 320px/360px/200% zoom, grayscale/contrast, keyboard, reduced-motion and physical-browser evidence has not been recorded. DS-01..32 are not complete.

## Component 09 — Deployment/security — PARTIAL with release blockers

PASS: public GitHub repository; Vercel production; Supabase Free; publishable browser key only; no service-role runtime; RLS on both tables; direct anon table DML denied; sanitized Realtime invalidation; production has no automatic fake seed; production URL is public.

Release blockers/deviations: no committed lockfile; CI does not run lint + typecheck + tests + build as frozen; no security headers/CSP baseline; `.env.example` lacks `NEXT_PUBLIC_CANONICAL_APP_URL`; local code defaults to the production Supabase project; isolated DEV/Preview database topology is not implemented; wrappers are in `public` rather than narrow `api`; `anon` has EXECUTE on private implementation functions to make the invoker wrappers work, rather than the planned exposed-wrapper/private-helper boundary; no checked-in `supabase/tests/` or DEV seed fixtures.

## Component 10 — Integrated QA/submission — MISSING as a completed release gate

The production two-context walkthrough proves one important path (post -> claim -> release -> reclaim -> collect -> copy), but it is not the complete release contract. REL-01..42 do not all have evidence; QA-01..27 are not all green; 10-client race, lost-response idempotency, short no-show fixture, hold/spoil boundary, slow-3G ambiguous mutations, Realtime-disconnect fallback, 320/360/200% zoom, full leakage inspection, fresh-clone README reproduction and same-commit evidence remain incomplete. Submission is therefore blocked.

## Playbook audit

The implementation playbook correctly called for a vertical slice and later hardening, but implementation accelerated from green build/public smoke to a submission-ready conclusion before the frozen Component 10 release contract had been executed. The corrective action is this parity audit + hardening branch, followed by a documented REL/QA evidence run.

## Stop-ship priorities

1. Restore release infrastructure: lockfile, deterministic CI, test scripts/evidence.
2. Fix server-adjusted countdown/board error semantics and claim deadline truthfulness.
3. Fix Copy Summary conservative time, canonical URL, stale fallback and attempt locking.
4. Add lifecycle confirmations/deadline warnings and pending-claim focus recovery.
5. Add security headers and remove production-as-local-default behavior.
6. Resolve/explicitly version the C09 `api/private` database boundary before submission.
7. Execute DB/claim/no-show/slow-3G/realtime/mobile/security release suite and record REL-01..42 + QA-01..27.

No submission recommendation is valid until the stop-ship items are closed and retested.