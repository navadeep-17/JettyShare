import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const LISTING_ID = '72000000-0000-4000-8000-000000000001'
const OLD_CLAIM_VERSION = '72000000-0000-4000-8000-000000000002'
const OLD_CLAIM_TOKEN = 'R'.repeat(43)

async function seedReleasedClaim(context: BrowserContext) {
  await context.addInitScript(({ listingId, claimVersion, claimToken }) => {
    localStorage.setItem('jettyshare:v1:profile', JSON.stringify({
      crewLabel: 'QA Reclaim Crew',
      updatedAt: new Date().toISOString(),
    }))
    localStorage.setItem('jettyshare:v1:claims', JSON.stringify({
      [listingId]: {
        claimVersion,
        claimToken,
        claimantLabel: 'QA Reclaim Crew',
        state: 'held',
        requestedLocallyAt: new Date().toISOString(),
        claimExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        itemExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    }))
  }, { listingId: LISTING_ID, claimVersion: OLD_CLAIM_VERSION, claimToken: OLD_CLAIM_TOKEN })
}

async function mockReleasedListing(page: Page) {
  let available = true
  const now = Date.now()
  const expiresAt = new Date(now + 30 * 60_000).toISOString()

  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime isolated for provider-release reclaim QA' })
  })

  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server_now: new Date().toISOString(),
        next_transition_at: available ? expiresAt : null,
        items: available ? [{
          id: LISTING_ID,
          item_type: 'BAIT',
          quantity_value: 5,
          quantity_unit: 'BUCKET',
          berth: '15',
          poster_label: 'QA Provider Release',
          created_at: new Date(now - 60_000).toISOString(),
          expires_at: expiresAt,
        }] : [],
      }),
    })
  })

  return {
    expiresAt,
    markClaimed: () => { available = false },
  }
}

function postgrestError(message: string) {
  return JSON.stringify({ code: 'P0001', details: null, hint: null, message })
}

function receiptFromRequest(route: Route, expiresAt: string) {
  const body = route.request().postDataJSON() as {
    p_claim_version: string
    p_claimant_label: string
  }
  const now = Date.now()
  return {
    listing_id: LISTING_ID,
    claim_version: body.p_claim_version,
    item_type: 'BAIT',
    quantity_value: 5,
    quantity_unit: 'BUCKET',
    berth: '15',
    poster_label: 'QA Provider Release',
    claimant_label: body.p_claimant_label,
    effective_status: 'CLAIMED',
    claimed_at: new Date(now).toISOString(),
    claim_expires_at: new Date(Math.min(now + 15 * 60_000, new Date(expiresAt).getTime())).toISOString(),
    expires_at: expiresAt,
    server_now: new Date(now).toISOString(),
  }
}

test.describe('provider release -> same claimant reclaim regression', () => {
  test('a provider-released stale local hold is reconciled and the same tap creates a fresh claim generation', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedReleasedClaim(context)
    const page = await context.newPage()
    const board = await mockReleasedListing(page)

    let receiptChecks = 0
    let claimRequests = 0
    let winningVersion = ''
    let winningToken = ''

    await page.route('**/rest/v1/rpc/get_claim_receipt', async (route) => {
      const body = route.request().postDataJSON() as { p_claim_version: string; p_claim_token: string }
      receiptChecks += 1
      if (body.p_claim_version === OLD_CLAIM_VERSION && body.p_claim_token === OLD_CLAIM_TOKEN) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: postgrestError('CAPABILITY_INVALID') })
        return
      }

      const now = Date.now()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          listing_id: LISTING_ID,
          claim_version: winningVersion,
          item_type: 'BAIT',
          quantity_value: 5,
          quantity_unit: 'BUCKET',
          berth: '15',
          poster_label: 'QA Provider Release',
          claimant_label: 'QA Reclaim Crew',
          effective_status: 'CLAIMED',
          claimed_at: new Date(now).toISOString(),
          claim_expires_at: new Date(Math.min(now + 15 * 60_000, new Date(board.expiresAt).getTime())).toISOString(),
          expires_at: board.expiresAt,
          server_now: new Date(now).toISOString(),
        }),
      })
    })

    await page.route('**/rest/v1/rpc/claim_listing', async (route) => {
      claimRequests += 1
      const body = route.request().postDataJSON() as {
        p_claim_version: string
        p_claim_token: string
      }
      winningVersion = body.p_claim_version
      winningToken = body.p_claim_token
      board.markClaimed()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(receiptFromRequest(route, board.expiresAt)),
      })
    })

    await page.goto('/')
    const card = page.locator('.supply-card', { hasText: 'BERTH 15' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /Claim/ }).click()

    await expect(page.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()
    expect(receiptChecks).toBe(1)
    expect(claimRequests).toBe(1)
    expect(winningVersion).not.toBe(OLD_CLAIM_VERSION)
    expect(winningToken).not.toBe(OLD_CLAIM_TOKEN)

    const saved = await page.evaluate((listingId) => {
      const claims = JSON.parse(localStorage.getItem('jettyshare:v1:claims') || '{}')
      return claims[listingId]
    }, LISTING_ID)
    expect(saved.state).toBe('held')
    expect(saved.claimVersion).toBe(winningVersion)
    expect(saved.claimToken).toBe(winningToken)

    await context.close()
  })

  test('Activity silently removes a provider-released stale claim instead of rendering CAPABILITY_INVALID', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedReleasedClaim(context)
    const page = await context.newPage()
    await mockReleasedListing(page)

    await page.route('**/rest/v1/rpc/get_claim_receipt', async (route) => {
      await route.fulfill({ status: 400, contentType: 'application/json', body: postgrestError('CAPABILITY_INVALID') })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()

    await expect(page.getByText('No current claims on this device.')).toBeVisible()
    await expect(page.getByText(/CAPABILITY_INVALID/)).toHaveCount(0)
    const claims = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:claims') || '{}'))
    expect(claims[LISTING_ID]).toBeUndefined()

    await context.close()
  })
})