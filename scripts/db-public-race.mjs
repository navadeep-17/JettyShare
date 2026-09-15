import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const url = process.env.JETTYSHARE_SUPABASE_URL
const key = process.env.JETTYSHARE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('JETTYSHARE_SUPABASE_URL and JETTYSHARE_SUPABASE_PUBLISHABLE_KEY are required')

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const token = () => randomBytes(32).toString('base64url')
const listingId = randomUUID()
const ownerToken = token()
const berth = `R${Date.now().toString().slice(-7)}`.slice(0, 12)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(name, args) {
  return supabase.rpc(name, args)
}

async function main() {
  const created = await rpc('create_listing', {
    p_listing_id: listingId,
    p_item_type: 'ICE',
    p_quantity_value: 10,
    p_quantity_unit: 'KG',
    p_berth: berth,
    p_poster_label: 'QA Race Provider',
    p_spoil_minutes: 30,
    p_owner_token: ownerToken,
  })
  if (created.error) throw created.error

  const attempts = Array.from({ length: 10 }, (_, index) => ({
    label: `QA Racer ${index + 1}`,
    version: randomUUID(),
    capability: token(),
  }))

  const results = await Promise.all(attempts.map(async (attempt) => ({
    attempt,
    result: await rpc('claim_listing', {
      p_listing_id: listingId,
      p_claimant_label: attempt.label,
      p_claim_version: attempt.version,
      p_claim_token: attempt.capability,
    }),
  })))

  const winners = results.filter(({ result }) => !result.error)
  const losers = results.filter(({ result }) => result.error)
  assert(winners.length === 1, `expected exactly 1 winner, got ${winners.length}`)
  assert(losers.length === 9, `expected 9 losers, got ${losers.length}`)
  for (const { result } of losers) {
    assert(result.error.message.includes('CLAIM_UNAVAILABLE'), `unexpected loser error: ${result.error.message}`)
  }

  const winner = winners[0]
  const first = winner.result.data
  const retry = await rpc('claim_listing', {
    p_listing_id: listingId,
    p_claimant_label: winner.attempt.label,
    p_claim_version: winner.attempt.version,
    p_claim_token: winner.attempt.capability,
  })
  if (retry.error) throw retry.error
  assert(retry.data.claimed_at === first.claimed_at, 'idempotent retry changed claimed_at')
  assert(retry.data.claim_expires_at === first.claim_expires_at, 'idempotent retry extended claim hold')

  const wrongRelease = await rpc('release_claim', {
    p_listing_id: listingId,
    p_claim_version: winner.attempt.version,
    p_claim_token: token(),
  })
  assert(wrongRelease.error && wrongRelease.error.message.includes('CAPABILITY_INVALID'), 'wrong claimant capability was not rejected')

  const directUpdate = await supabase.from('listings').update({ berth: 'BAD' }).eq('id', listingId)
  assert(Boolean(directUpdate.error), 'direct anonymous UPDATE unexpectedly succeeded')

  const collected = await rpc('confirm_collected', {
    p_listing_id: listingId,
    p_expected_claim_version: winner.attempt.version,
    p_owner_token: ownerToken,
  })
  if (collected.error) throw collected.error

  const snapshot = await rpc('get_board_snapshot', {})
  if (snapshot.error) throw snapshot.error
  assert(!snapshot.data.items.some((item) => item.id === listingId), 'collected QA listing remained on active board')

  console.log(JSON.stringify({
    result: 'PASS',
    listingId,
    berth,
    winner: winner.attempt.label,
    checks: [
      '10 simultaneous first-time claims -> exactly one winner',
      '9 race losers -> CLAIM_UNAVAILABLE',
      'same claim version/token retry is idempotent',
      'retry does not extend claim hold',
      'wrong claim capability is rejected',
      'direct anonymous listings UPDATE is denied',
      'provider confirms current generation collected',
      'collected QA row is absent from active board',
    ],
  }, null, 2))
}

main().catch((error) => {
  console.error('[db-public-race] FAIL', error?.message || error)
  process.exit(1)
})
