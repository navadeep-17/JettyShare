# OAKS submission note

## Trade-offs & decisions

I optimized JettyShare for the fastest reliable physical handoff rather than feature breadth. Posting asks only for supply type, quantity, berth and spoil time, while the public board sorts by the database-authoritative expiry deadline so the most urgent supply is seen first.

I deliberately did not build accounts, email/password verification, OTPs, chat, maps, payments, ratings, photos or push notifications. In a 30-boat harbor those features add setup friction, bandwidth and failure modes. A boat/crew label is stored locally for coordination, while authorization uses random device-held capability tokens; only SHA-256 digests are stored in PostgreSQL.

Claims are decided atomically in PostgreSQL under a row lock, so simultaneous skippers cannot both win. Every claim also has a unique claim version, preventing a stale claimant or provider screen from modifying a newer reservation. Database time—not the phone countdown—is the source of truth for expiry.

To handle no-shows, claims are temporary holds lasting at most 15 minutes and never beyond the spoil deadline. A timed-out claim becomes available again automatically if the item is still fresh, without requiring a cron job. Claimants can also release early, and providers confirm collection.

For slow 3G, create/claim identifiers and capabilities are saved before requests are sent. Lost responses can therefore retry the exact operation safely instead of creating duplicates. Realtime messages only signal that something changed; clients always refetch the authoritative board, with periodic reconciliation as a fallback.
