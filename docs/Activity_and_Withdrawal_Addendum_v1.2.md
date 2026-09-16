# JettyShare Activity + Withdrawal Addendum v1.2

Status: additive successor contract to the frozen v1.0/v1.1 implementation.

This addendum does not replace the original Components 01–10. It adds two narrow operational capabilities discovered during final physical-handoff testing: device-local recent activity and provider withdrawal of a published supply.

## 1. Recent Activity

`My Activity` keeps its original meaning for live authority:

- **My Posts** = listings this browser can currently manage with its owner capability.
- **My Claims** = reservations this browser can currently manage with its claim capability.

A new **Recent Activity** section is informational history only.

Rules:

1. History is local to the current browser/device. A matching crew label on another browser does not grant access to it.
2. History must never contain owner tokens, claim tokens, capability digests, pickup codes, service keys, or any other authorization secret.
3. History stores only redacted handoff facts needed to recognize a past action: role (POST/CLAIM), item, quantity/unit, berth, non-authoritative counterparty label when available, terminal outcome, and event time.
4. History is capped at the 20 most recent entries and is user-clearable.
5. Clearing Recent Activity must not alter live posts, claims, or database state.
6. Existing pre-v1.2 actions are not reconstructed by crew label because crew labels are coordination labels, not identity.

Recognized outcomes are `COLLECTED`, `RELEASED`, `EXPIRED`, `WITHDRAWN`, `HOLD_ENDED`, and a generic `ENDED` when the browser can prove the reservation is no longer authoritative but cannot safely distinguish the exact remote cause.

## 2. Provider Withdrawal

Published listings remain immutable. JettyShare still does not support in-place editing of item type, quantity, berth, or spoil deadline.

Instead, the provider may **Withdraw supply** using the original owner capability.

Withdrawal rules:

1. Only the browser possessing the valid owner capability may withdraw the listing.
2. Withdrawal is allowed while the listing is effectively ACTIVE or while a live claimant currently holds it.
3. Withdrawal is terminal for that listing. It must not reopen automatically and cannot be claimed again.
4. If a live claimant exists, withdrawal cancels that reservation rather than releasing it back to the board.
5. The current claim generation/capability remains readable only long enough for that authorized claimant to observe the terminal `WITHDRAWN` result; no public claim data is exposed.
6. A withdrawn listing disappears from the public board immediately through the same database-authoritative refetch/reconciliation model as other state changes.
7. A collected listing cannot be withdrawn. An already-expired listing does not need withdrawal.
8. Retrying the same withdrawal with the same owner capability is idempotent.
9. Wrong owner capability returns the same generic capability failure model used by other protected provider actions.

## 3. Storage / State Representation

`public.listings.withdrawn_at` records the terminal provider withdrawal time.

For minimal migration risk, v1.2 does not add another PostgreSQL enum value. `WITHDRAWN` is an effective terminal state derived when `withdrawn_at IS NOT NULL`.

The withdrawal transition also moves the listing expiry boundary to the authoritative withdrawal timestamp. For a currently claimed listing, the claim deadline is moved to the same timestamp. This preserves existing database consistency constraints, removes the listing from the board, and causes any later claim attempt to fail while the current authorized claimant can still observe `WITHDRAWN` through the capability-gated receipt.

## 4. Acceptance Checks

- H01: a completed provider post is moved from My Posts into Recent Activity without retaining its owner token in history.
- H02: a completed claimant reservation is moved from My Claims into Recent Activity without retaining its claim token or pickup code in history.
- H03: Recent Activity persists across reload on the same browser and is absent on an unrelated browser.
- H04: clearing history leaves active authority untouched.
- W01: owner can withdraw an ACTIVE fresh listing; it immediately leaves the public board.
- W02: owner can withdraw a currently CLAIMED fresh listing; it does not reopen.
- W03: the current claimant can reconcile the same claim generation to terminal `WITHDRAWN`.
- W04: a new claimant cannot claim a withdrawn listing.
- W05: wrong owner capability cannot withdraw.
- W06: collected and already-expired listings cannot be meaningfully withdrawn.
- W07: Realtime loss still converges through authoritative refetch/focus/periodic reconciliation.
- W08: withdrawal and recent history remain usable at the 320/360px mobile targets.

## 5. Non-goals

This addendum does not add accounts, server-side user history, cross-device identity, general edit-in-place, restoration/undo of a withdrawn listing, chat, ratings, payments, maps, or push notifications.

A provider who entered materially wrong supply details should withdraw the listing and create a fresh post rather than mutate a listing that another skipper may already have observed.
