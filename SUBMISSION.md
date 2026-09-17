# OAKS submission note

## Trade-offs & decisions

I optimized JettyShare for the fastest reliable physical handoff rather than feature breadth. Posting asks only for supply type, quantity, berth and spoil time, while the public board sorts by database-authoritative expiry so the most urgent supply is seen first.

I deliberately did not build accounts, email/password verification, phone verification, OTPs, chat, maps, payments, ratings, photos or push notifications. In a 30-boat harbor those features add setup friction, bandwidth and failure modes. A boat/crew label is stored locally only for coordination; authorization uses random device-held capability tokens, with only SHA-256 digests stored in PostgreSQL.

Claims are decided atomically under a PostgreSQL row lock, so simultaneous skippers cannot both win. Every claim has a unique version, preventing stale claimant or provider screens from modifying a newer reservation. Database time—not the phone countdown—is authoritative.

At pickup, the claimant shows a four-digit code derived from the current claim capability. The provider verifies it using the owner capability and current claim version, and PostgreSQL checks it again before collection. This proves control of the reservation without turning JettyShare into an identity platform.

Claims last at most 15 minutes and never beyond spoil time. No-shows automatically reopen while fresh. Providers can withdraw unavailable supply instead of editing a listing another crew may have seen or claimed; withdrawal is terminal and cancels any current reservation.

My Activity separates live capabilities from a redacted, device-local 20-entry history. Completed activity never stores capability tokens or pickup codes and is not shared merely because another browser uses the same crew label.

For slow 3G, create/claim identifiers and capabilities are saved before requests. Lost responses retry the exact operation safely instead of creating duplicates. Realtime only signals change; clients refetch authoritative state with periodic reconciliation.
