# JettyShare DEV QA evidence

This file records evidence from the isolated `JettyShare-DEV` Supabase project. It is not a submission-ready declaration; production promotion remains blocked until Preview and the full Component 10 release suite pass.

## Environment

- Supabase project: `JettyShare-DEV`
- Project ref: `ysexholoqrxyuqhmrkuq`
- Region: `ap-south-1`
- Production project is not used for these tests.

## Migrations applied in DEV

1. `001_core_schema_and_rpcs`
2. `002_spec_parity_constraints`
3. `003_claim_receipt_and_retry_contract`

The hardening migrations have **not** been promoted to PROD yet.

## Passing database evidence

- Rollback-only state-machine suite: PASS.
- DEV timing/no-show/stale-generation suite: PASS.
- Public-client Data API and 10-client race workflow: PASS.
  - exactly one of ten simultaneous first claims wins;
  - nine return `CLAIM_UNAVAILABLE`;
  - exact winner retry is idempotent and does not extend the hold;
  - wrong capability is rejected;
  - direct anonymous table mutations are denied;
  - private capability data/private implementation RPCs are not exposed through the public Data API;
  - collected rows leave the active board.
- Relative-time DEV fixtures prove urgency ordering, stale-hold reopening while fresh, and expired-row exclusion.

## Vercel environment isolation evidence

- Existing Vercel project: `jettyshare`.
- Connected Git repository: `navadeep-17/JettyShare`.
- Production branch tracking: `main` only.
- Stable production domain: `https://jettyshare.vercel.app`.
- Production environment variables are scoped separately from Preview/Development.
- Preview and Development are configured for the DEV Supabase project; Production is configured for the PROD Supabase project.
- Preview canonical URL remains intentionally unset until the first Git-backed Preview URL is created and verified.

## Remaining release work

A Git-backed `hardening-spec-parity` Preview must be created and verified through `/diagnostics`, then the production-like Preview smoke/security checks must pass. Only after those gates are green may the exact forward migrations be considered for PROD promotion.
