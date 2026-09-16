# Component 09 implementation addendum v1.1 — superseded by parity restoration

Status: **superseded implementation-time refinement**. Component 09 v1.0 remains the release contract.

## Why this addendum existed

The first hosted JettyShare database had been bootstrapped with browser-callable wrappers in Supabase's default exposed `public` schema. During the hardening audit, v1.1 documented temporarily retaining that deployment mechanism while preserving the authorization invariants.

## Final hardening decision

That temporary refinement is no longer the submission design. The hardening implementation restores the frozen Component 09 boundary:

- browser-callable RPC wrappers live in the explicit exposed `api` schema;
- guarded business implementations live in `private` and use `SECURITY DEFINER` with `search_path=''` and schema-qualified references;
- authoritative listings remain in `public`, but direct anonymous table DML is denied;
- capability digests remain in `private.listing_capabilities` and are not exposed through the Data API;
- browser code calls `supabase.schema('api')` only;
- the browser receives only the project URL and publishable key, never a service-role/secret key;
- Realtime remains sanitized invalidation followed by an authoritative snapshot refetch.

The isolated DEV project already runs this `api`/`private` model and the public-client security/race suite passes against it. The Production database retains its legacy public-wrapper surface only until the coordinated release cutover; at that point the committed API-boundary migrations are applied immediately before the hardened `main` deployment is verified.

## Release proof required

Final Production evidence must prove:

1. only `api` is exposed through the browser Data API;
2. direct anonymous listing INSERT/UPDATE/DELETE is denied;
3. `private.listing_capabilities` and private implementation functions are inaccessible through the Data API;
4. wrong capabilities and stale claim versions are rejected;
5. the deployed frontend is the exact tested Git SHA and uses the PROD Supabase project;
6. no capability, service-role secret, database password, or private payload is exposed in browser responses, logs, or Realtime events.

Until those Production checks are green, Component 09 is not a completed release gate.
