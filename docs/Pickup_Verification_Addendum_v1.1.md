# JettyShare Pickup Verification Addendum v1.1

## Purpose
JettyShare keeps boat / crew labels lightweight and unverified. This addendum adds a physical handoff proof without introducing accounts, OTPs, phone verification, chat, or a new identity system.

## Trust statement
A successful pickup-code check proves only that the person at the berth has access to the browser/session that controls the current claim. It does not verify a legal identity, phone number, vessel registration, or ownership of a crew label.

## Frozen pickup-verification flow
1. Every successful claim already has a random claim capability and a unique claim version.
2. The backend derives a four-digit pickup code from the SHA-256 digest of the current claim capability. The code is not stored as a new database secret and is never included in the public board snapshot or owner-management read model.
3. The claimant receives the pickup code only through claim-authorized responses (`claim_listing` and `get_claim_receipt`). The claimant shows or tells this code to the provider at physical pickup.
4. The provider enters the four-digit code from My Activity. `verify_pickup_code` requires the owner capability, the exact current claim version, a live unexpired hold, and the matching pickup code.
5. `confirm_collected` requires the same pickup code again server-side. UI verification alone is never sufficient to mark an item collected.
6. A release, no-show, expiry, collection, or newer claim generation invalidates the previous code automatically because verification is bound to the exact current claim version and claim-capability digest.
7. Wrong or malformed codes return the generic `PICKUP_CODE_INVALID` error; the expected code is never returned to the provider.
8. Network uncertainty never clears owner or claimant capabilities merely because verification could not complete.

## Code derivation
For the current claim capability digest `D = SHA-256(claim_token)`, the code is:

`((D[0] * 256) + D[1]) mod 10000`, zero-padded to four digits.

The digest remains the authoritative secret material stored by PostgreSQL; the four-digit value is only a short-lived physical handoff proof.

## Compatibility and security
The browser-facing Data API remains `api`-schema only. No raw owner token, claim token, claim-token digest, or expected pickup code is added to the public board or provider read model. Provider release remains available without pickup verification so a bad/no-show claim can still be cleared safely.
