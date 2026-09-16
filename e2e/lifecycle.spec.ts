import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const LISTING_ID = '30000000-0000-4000-8000-000000000001'
const CLAIM_VERSION = '30000000-0000-4000-8000-000000000002'
const OWNER_TOKEN = 'O'.repeat(43)
const CLAIM_TOKEN = 'C'.repeat(43)

async function seedBase(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('jettyshare:v1:profile', JSON.stringify({ crewLabel: 'QA Lifecycle Crew', updatedAt: new Date().toISOString() }))
  })
}

async function seedClaim(context: BrowserContext) {
  await seedBase(context)
  await context.addInitScript(({ listingId, claimVersion, claimToken }) => {
    localStorage.setItem('jettyshare:v1:claims', JSON.stringify({
      [listingId]: {
        claimVersion,
        claimToken,
        claimantLabel: 'QA Lifecycle Claimant',
        state: 'held',
        requestedLocallyAt: new Date().toISOString(),
      },
    }))
  }, { listingId: LISTING_ID, claimVersion: CLAIM_VERSION, claimToken: CLAIM_TOKEN })
}

async function seedOwner(context: BrowserContext) {
  await seedBase(context)
  await context.addInitScript(({ listingId, ownerToken }) => {
    localStorage.setItem('jettyshare:v1:owned-listings', JSON.stringify({
      [listingId]: {
        ownerToken,
        state: 'managed',
        createdLocallyAt: new Date().toISOString(),
      },
    }))
  }, { listingId: LISTING_ID, ownerToken: OWNER_TOKEN })
}

async function mockEmptyBoard(page: Page) {
  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime intentionally unavailable for Component 06 isolated QA' })
  })
  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ server_now: new Date().toISOString(), next_transition_at: null, items: [] }),
    })
  })
}

function managedClaim(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    listing_id: LISTING_ID,
    claim_version: CLAIM_VERSION,
    item_type: 'ICE',
    quantity_value: 11,
    quantity_unit: 'KG',
    berth: 'LIFE-1',
    poster_label: 'QA Provider',
    claimant_label: 'QA Lifecycle Claimant',
    effective_status: 'CLAIMED',
    claimed_at: new Date(now - 60_000).toISOString(),
    claim_expires_at: new Date(now + 10 * 60_000).toISOString(),
    expires_at: new Date(now + 30 * 60_000).toISOString(),
    server_now: new Date(now).toISOString(),
    pickup_code: '2468',
    ...overrides,
  }
}

function managedPost(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    listing_id: LISTING_ID,
    item_type: 'ICE',
    quantity_value: 11,
    quantity_unit: 'KG',
    berth: 'LIFE-1',
    poster_label: 'QA Provider',
    effective_status: 'CLAIMED',
    claim_version: CLAIM_VERSION,
    claimant_label: 'QA Lifecycle Claimant',
    claimed_at: new Date(now - 60_000).toISOString(),
    claim_expires_at: new Date(now + 10 * 60_000).toISOString(),
    expires_at: new Date(now + 30 * 60_000).toISOString(),
    server_now: new Date(now).toISOString(),
    ...overrides,
  }
}

test.describe('Component 06 lifecycle and management release gates', () => {
  test('claimant release confirmation cancel makes no RPC; accept releases exact saved generation and clears the secret', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedClaim(context)
    const page = await context.newPage()
    await mockEmptyBoard(page)

    let releaseCalls = 0
    let releasedBody: Record<string, unknown> | null = null
    await page.route('**/rest/v1/rpc/get_claim_receipt', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managedClaim()) })
    })
    await page.route('**/rest/v1/rpc/release_claim', async (route) => {
      releaseCalls += 1
      releasedBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ released: true, server_now: new Date().toISOString() }) })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })
    await expect(card).toBeVisible()

    page.once('dialog', (dialog) => dialog.dismiss())
    await card.getByRole('button', { name: 'I can’t make it — release', exact: true }).click()
    expect(releaseCalls).toBe(0)
    await expect(card).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await card.getByRole('button', { name: 'I can’t make it — release', exact: true }).click()
    await expect(page.getByText(/Claim released/)).toBeVisible()
    expect(releaseCalls).toBe(1)
    expect(releasedBody).toMatchObject({
      p_listing_id: LISTING_ID,
      p_claim_version: CLAIM_VERSION,
      p_claim_token: CLAIM_TOKEN,
    })
    const claims = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:claims') || '{}'))
    expect(claims[LISTING_ID]).toBeUndefined()
    await context.close()
  })

  test('ambiguous provider release keeps owner authority and a last-known card in CHECKING state with destructive controls disabled', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedOwner(context)
    const page = await context.newPage()
    await mockEmptyBoard(page)

    let reads = 0
    let mutationAttempted = false
    await page.route('**/rest/v1/rpc/get_owned_listing', async (route) => {
      reads += 1
      if (mutationAttempted) {
        await route.abort('failed')
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managedPost()) })
    })
    await page.route('**/rest/v1/rpc/owner_release_claim', async (route) => {
      mutationAttempted = true
      await route.abort('failed')
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })
    await expect(card).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await card.getByRole('button', { name: 'Release claim', exact: true }).click()

    await expect(page.getByText(/provider release result is uncertain/i)).toBeVisible()
    await expect(card.getByText('CHECKING', { exact: true })).toBeVisible()
    await expect(card.getByText(/CHECKING STATUS — management actions are disabled/i)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Confirm collected', exact: true })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Release claim', exact: true })).toBeDisabled()
    expect(reads).toBeGreaterThanOrEqual(2)

    const owned = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:owned-listings') || '{}'))
    expect(owned[LISTING_ID]?.ownerToken).toBe(OWNER_TOKEN)
    await context.close()
  })

  test('lost collection response converges through owner reconciliation to COLLECTED and clears terminal owner authority', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedOwner(context)
    const page = await context.newPage()
    await mockEmptyBoard(page)

    let collected = false
    let confirmCalls = 0
    await page.route('**/rest/v1/rpc/get_owned_listing', async (route) => {
      const data = collected
        ? managedPost({ effective_status: 'COLLECTED', claim_expires_at: null, collected_at: new Date().toISOString() })
        : managedPost()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.route('**/rest/v1/rpc/verify_pickup_code', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true, claimant_label: 'QA Lifecycle Claimant', claim_version: CLAIM_VERSION, server_now: new Date().toISOString() }) })
    })
    await page.route('**/rest/v1/rpc/confirm_collected', async (route) => {
      confirmCalls += 1
      const body = route.request().postDataJSON() as Record<string, unknown>
      expect(body.p_pickup_code).toBe('2468')
      collected = true
      await route.abort('failed')
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })
    await expect(card).toBeVisible()
    const confirm = card.getByRole('button', { name: 'Confirm collected', exact: true })
    await expect(confirm).toBeDisabled()
    await card.getByLabel('Pickup code for berth LIFE-1').fill('2468')
    await card.getByRole('button', { name: 'Verify pickup code', exact: true }).click()
    await expect(confirm).toBeEnabled()
    page.once('dialog', (dialog) => dialog.accept())
    await confirm.click()

    await expect(card.getByText('COLLECTED', { exact: true })).toBeVisible()
    await expect(card.getByText('Collected.', { exact: true })).toBeVisible()
    expect(confirmCalls).toBe(1)
    const owned = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:owned-listings') || '{}'))
    expect(owned[LISTING_ID]).toBeUndefined()
    await context.close()
  })

  test('provider activity at 360px shows hold warning, separate deadlines, confirm-before guidance and tappable controls without overflow', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    await seedOwner(context)
    const page = await context.newPage()
    await mockEmptyBoard(page)

    const serverNow = Date.now()
    await page.route('**/rest/v1/rpc/get_owned_listing', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(managedPost({
          server_now: new Date(serverNow).toISOString(),
          claim_expires_at: new Date(serverNow + 90_000).toISOString(),
          expires_at: new Date(serverNow + 12 * 60_000).toISOString(),
        })),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })
    await expect(card.getByText('HOLD ENDING SOON', { exact: true })).toBeVisible()
    await expect(card.getByText('HOLD ENDS', { exact: true })).toBeVisible()
    await expect(card.getByText('SPOILS', { exact: true })).toBeVisible()
    await expect(card.getByText(/^Confirm before /)).toBeVisible()
    const confirm = card.getByRole('button', { name: 'Confirm collected', exact: true })
    const verify = card.getByRole('button', { name: 'Verify pickup code', exact: true })
    const release = card.getByRole('button', { name: 'Release claim', exact: true })
    await expect(confirm).toBeDisabled()
    await expect(verify).toBeDisabled()
    await expect(release).toBeEnabled()
    await card.getByLabel('Pickup code for berth LIFE-1').fill('2468')
    await expect(verify).toBeEnabled()
    const beforeVerificationSizes = await Promise.all([verify, release].map((button) => button.boundingBox()))
    for (const box of beforeVerificationSizes) expect(box && box.height >= 44).toBeTruthy()
    await page.route('**/rest/v1/rpc/verify_pickup_code', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true, claimant_label: 'QA Lifecycle Claimant', claim_version: CLAIM_VERSION, server_now: new Date().toISOString() }) })
    })
    await verify.click()
    await expect(confirm).toBeEnabled()
    const verified = card.getByRole('button', { name: 'Verified ✓', exact: true })
    await expect(verified).toBeVisible()
    const afterVerificationSizes = await Promise.all([confirm, verified, release].map((button) => button.boundingBox()))
    for (const box of afterVerificationSizes) expect(box && box.height >= 44).toBeTruthy()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
    await context.close()
  })

  test('focus reconciliation replaces a stale claimed provider view before management can remain actionable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedOwner(context)
    const page = await context.newPage()
    await mockEmptyBoard(page)

    let ended = false
    let reads = 0
    await page.route('**/rest/v1/rpc/get_owned_listing', async (route) => {
      reads += 1
      const data = ended
        ? managedPost({ effective_status: 'ACTIVE', claim_version: null, claimant_label: null, claim_expires_at: null })
        : managedPost()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })
    await expect(card.getByRole('button', { name: 'Confirm collected', exact: true })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Release claim', exact: true })).toBeEnabled()
    await expect(card.getByLabel('Pickup code for berth LIFE-1')).toBeEnabled()

    const readsBeforeFocus = reads
    ended = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(card.getByText('ACTIVE', { exact: true })).toBeVisible()
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeFocus)
    await expect(card.getByRole('button', { name: 'Confirm collected', exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Release claim', exact: true })).toHaveCount(0)
    await context.close()
  })
})
