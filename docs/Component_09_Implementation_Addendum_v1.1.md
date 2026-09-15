# Component 09 implementation addendum v1.1

Status: implementation-time refinement to **Component 09 — Deployment + Security Configuration v1.0**. It does not alter OAKS-required behavior, claim correctness, capability authorization, server-time authority, or the public UX.

## Refined Data API wrapper location

Component 09 v1.0 preferred an exposed `api` schema with SECURITY INVOKER wrappers calling `private.*_impl` SECURITY DEFINER routines. The deployed Supabase project was initially bootstrapped with the default exposed `public` schema before this hardening audit.

For the submission build, JettyShare retains the already-deployed small browser RPC wrappers in `public` instead of changing the project-wide PostgREST exposed-schema setting during the release window. This is an intentional deployment-mechanism refinement, not a weakening of the authorization model.

The required security invariants remain:

1. Browser roles have no direct INSERT/UPDATE/DELETE authority on `public.listings`.
2. Browser roles have no SELECT/DML authority on `private.listing_capabilities`.
3. The `private` schema is not an exposed PostgREST schema; private helper functions are not callable as Data API endpoints.
4. Public wrappers return only public-safe data and perform no privileged data access themselves; guarded implementation functions enforce server time, capability digests, state and expected `claim_version`.
5. All SECURITY DEFINER functions use `search_path=''` and schema-qualified references.
6. The browser still receives only a Supabase publishable key; no service-role/secret key exists in the runtime.
7. Realtime remains a sanitized `board_changed` invalidation signal followed by an authoritative snapshot read.

## Release proof required

Before this addendum is accepted for submission, automated/public-client checks must prove:

- direct anonymous listing DML is denied;
- `private.listing_capabilities` cannot be queried through the Data API;
- a private implementation function cannot be addressed through the Data API;
- only the intended public wrapper functions are used by the browser;
- wrong capabilities and stale claim versions are rejected.

If any of those checks fail, this refinement is invalid and the release is blocked.
