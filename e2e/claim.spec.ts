import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const LISTING_ID = '20000000-0000-4000-8000-000000000001'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function blockRealtime(page: Page) {
  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime intentionally unavailable for Component 05 isolated QA' })
  })
}

async function seedProfile(context: BrowserContext, crewLabel: string) {
  await context.addInitScript((label) => {
    localStorage.setItem('jettyshare:v1:profile', JSON.stringify({ crewLabel: label, updatedAt: new Date().toISOString() }))
  }, crewLabel)
}

async function mockSingleListing(page: Page, options?: { berth?: string; posterLabel?: string }) {
  const berth = options?.berth ?? 'C05'
  const posterLabel = options?.posterLabel ?? 'QA Provider'
  let available = true
  const now = Date.now()
  const expiresAt = new Date(now + 30 * 60_000).toISOString()

  await blockRealtime(page)
  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server_now: new Date().toISOString(),
        next_transition_at: available ? expiresAt : null,
        items: available ? [{
          id: LISTING_ID,
          item_type: 'ICE',
          quantity_value: 9,
          quantity_unit: 'KG',
          berth,
          poster_label: posterLabel,
          created_at: new Date(now - 60_000).toISOString(),
          expires_at: expiresAt,
        }] : [],
      }),
    })
  })

  return {
    berth,
    posterLabel,
    expiresAt,
    markClaimed: () => { available = false },
  }
}

function receiptFromRequest(route: Route, berth: string, posterLabel: string, expiresAt: string) {
  const body = route.request().postDataJSON() as {
    p_claim_version: string
    p_claimant_label: string
  }
  const now = Date.now()
  return {
    listing_id: LISTING_ID,
    claim_version: body.p_claim_version,
    item_type: 'ICE',
    quantity_value: 9,
    quantity_unit: 'KG',
    berth,
    poster_label: posterLabel,
    claimant_label: body.p_claimant_label,
    claimed_at: new Date(now).toISOString(),
    claim_expires_at: new Date(Math.min(now + 15 * 60_000, new Date(expiresAt).getTime())).toISOString(),
    expires_at: expiresAt,
    server_now: new Date(now).toISOString(),
  }
}

async function postSupply(page: Page, label: string, berth: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  const identity = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await identity.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: 'Save & Post', exact: true }).click()
  }
  await page.getByLabel('Quantity').fill('6')
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
}

test.describe('Component 05 Claim release gates', () => {
  test('repeat user performs a literal one-tap claim with no preflight and no secret leakage', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedProfile(context, 'QA Repeat Claimant')
    const page = await context.newPage()
    const board = await mockSingleListing(page)
    let claimRequests = 0
    let receiptChecks = 0
    let capturedToken = ''

    await page.route('**/rest/v1/rpc/get_claim_receipt', async (route) => {
      receiptChecks += 1
      await route.abort('failed')
    })
    await page.route('**/rest/v1/rpc/claim_listing', async (route) => {
      claimRequests += 1
      const body = route.request().postDataJSON() as { p_claim_token: string }
      capturedToken = body.p_claim_token
      board.markClaimed()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receiptFromRequest(route, board.berth, board.posterLabel, board.expiresAt)) })
    })

    await page.goto('/')
    const card = page.locator('.supply-card', { hasText: `BERTH ${board.berth}` })
    await card.getByRole('button', { name: /Claim/ }).click()

    await expect(page.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What should crews call your boat?' })).toHaveCount(0)
    expect(claimRequests).toBe(1)
    expect(receiptChecks).toBe(0)
    expect(capturedToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(page.url()).not.toContain(capturedToken)
    await expect(page.locator('body')).not.toContainText(capturedToken)
    await context.close()
  })

  test('first-use Save & Claim resumes the original listing while cancel sends no mutation or secret', async ({ browser }) => {
    const cancelContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const cancelPage = await cancelContext.newPage()
    await mockSingleListing(cancelPage, { berth: 'CANCEL' })
    let cancelRequests = 0
    await cancelPage.route('**/rest/v1/rpc/claim_listing', async (route) => {
      cancelRequests += 1
      await route.abort('failed')
    })
    await cancelPage.goto('/')
    await cancelPage.locator('.supply-card', { hasText: 'BERTH CANCEL' }).getByRole('button', { name: /Claim/ }).click()
    const identity = cancelPage.getByRole('dialog', { name: 'What should crews call your boat?' })
    await expect(identity).toBeVisible()
    await identity.getByRole('button', { name: 'Close' }).click()
    expect(cancelRequests).toBe(0)
    expect(await cancelPage.evaluate(() => localStorage.getItem('jettyshare:v1:claims'))).toBeNull()
    await cancelContext.close()

    const saveContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const savePage = await saveContext.newPage()
    const board = await mockSingleListing(savePage, { berth: 'FIRST' })
    let saveRequests = 0
    await savePage.route('**/rest/v1/rpc/claim_listing', async (route) => {
      saveRequests += 1
      board.markClaimed()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receiptFromRequest(route, board.berth, board.posterLabel, board.expiresAt)) })
    })
    await savePage.goto('/')
    await savePage.locator('.supply-card', { hasText: 'BERTH FIRST' }).getByRole('button', { name: /Claim/ }).click()
    await savePage.getByLabel('Boat / crew name').fill('QA First Claimant')
    await savePage.getByRole('button', { name: 'Save & Claim', exact: true }).click()
    await expect(savePage.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()
    expect(saveRequests).toBe(1)
    await saveContext.close()
  })

  test('storage failure blocks claim mutation but leaves the public board usable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem
      original.call(localStorage, 'jettyshare:v1:profile', JSON.stringify({ crewLabel: 'QA Storage Claimant', updatedAt: new Date().toISOString() }))
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'jettyshare:storage-probe' || key === 'jettyshare:v1:claims') throw new DOMException('Blocked for QA', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    })
    const page = await context.newPage()
    const board = await mockSingleListing(page, { berth: 'STORE' })
    let claimRequests = 0
    await page.route('**/rest/v1/rpc/claim_listing', async (route) => {
      claimRequests += 1
      await route.abort('failed')
    })

    await page.goto('/')
    const card = page.locator('.supply-card', { hasText: `BERTH ${board.berth}` })
    await card.getByRole('button', { name: /Claim/ }).click()
    await expect(page.getByText(/can’t save the access key needed to manage a claim/i)).toBeVisible()
    expect(claimRequests).toBe(0)
    await expect(card).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    await context.close()
  })

  test('corrupt persisted pending claim is rejected locally, cleared, and never sent as malformed RPC data', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedProfile(context, 'QA Corrupt Claimant')
    const page = await context.newPage()
    const board = await mockSingleListing(page, { berth: 'CORRUPT' })
    let claimRequests = 0
    await page.route('**/rest/v1/rpc/claim_listing', async (route) => {
      claimRequests += 1
      await route.abort('failed')
    })

    await page.goto('/')
    await page.evaluate((listingId) => {
      localStorage.setItem('jettyshare:v1:claims', JSON.stringify({
        [listingId]: {
          claimVersion: 'not-a-uuid',
          claimToken: 'too-short',
          claimantLabel: 'QA Corrupt Claimant',
          state: 'pending-claim',
          requestedLocallyAt: new Date().toISOString(),
        },
      }))
    }, LISTING_ID)

    await page.locator('.supply-card', { hasText: `BERTH ${board.berth}` }).getByRole('button', { name: /Claim/ }).click()
    await expect(page.getByText('This saved claim could not be verified on this device.')).toBeVisible()
    expect(claimRequests).toBe(0)
    const claims = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:claims') || '{}'))
    expect(claims[LISTING_ID]).toBeUndefined()
    await context.close()
  })

  test('same-tick double tap still produces one logical claim generation and one mutation', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedProfile(context, 'QA Double Tap')
    const page = await context.newPage()
    const board = await mockSingleListing(page, { berth: 'DOUBLE' })
    let claimRequests = 0
    const versions = new Set<string>()
    await page.route('**/rest/v1/rpc/claim_listing', async (route) => {
      claimRequests += 1
      const body = route.request().postDataJSON() as { p_claim_version: string }
      versions.add(body.p_claim_version)
      await new Promise((resolve) => setTimeout(resolve, 300))
      board.markClaimed()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receiptFromRequest(route, board.berth, board.posterLabel, board.expiresAt)) })
    })

    await page.goto('/')
    const button = page.locator('.supply-card', { hasText: `BERTH ${board.berth}` }).getByRole('button', { name: /Claim/ })
    await button.evaluate((element: HTMLButtonElement) => {
      element.click()
      element.click()
    })
    await expect(page.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()
    expect(claimRequests).toBe(1)
    expect(versions.size).toBe(1)
    await context.close()
  })

  test('two saved-profile browsers racing the same real DEV listing produce one receipt and one conflict', async ({ browser }) => {
    const id = suffix()
    const berth = `R${id}`.slice(0, 12)
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const claimantAContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const claimantBContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await seedProfile(claimantAContext, `QA Race A ${id}`)
    await seedProfile(claimantBContext, `QA Race B ${id}`)
    const provider = await providerContext.newPage()
    const a = await claimantAContext.newPage()
    const b = await claimantBContext.newPage()

    await provider.goto('/')
    await postSupply(provider, `QA Race Provider ${id}`, berth)
    await Promise.all([a.goto('/'), b.goto('/')])
    const aCard = a.locator('.supply-card', { hasText: `BERTH ${berth}` })
    const bCard = b.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(aCard).toBeVisible()
    await expect(bCard).toBeVisible()

    await Promise.all([
      aCard.getByRole('button', { name: /Claim/ }).click(),
      bCard.getByRole('button', { name: /Claim/ }).click(),
    ])

    await expect.poll(async () => {
      const aWon = await a.getByRole('dialog', { name: 'Supply claimed' }).isVisible().catch(() => false)
      const bWon = await b.getByRole('dialog', { name: 'Supply claimed' }).isVisible().catch(() => false)
      const aLost = await a.getByText('Someone just claimed this supply.').isVisible().catch(() => false)
      const bLost = await b.getByText('Someone just claimed this supply.').isVisible().catch(() => false)
      return { winners: Number(aWon) + Number(bWon), conflicts: Number(aLost) + Number(bLost) }
    }, { timeout: 12_000 }).toEqual({ winners: 1, conflicts: 1 })

    const aWon = await a.getByRole('dialog', { name: 'Supply claimed' }).isVisible().catch(() => false)
    const bWon = await b.getByRole('dialog', { name: 'Supply claimed' }).isVisible().catch(() => false)
    expect(Number(aWon) + Number(bWon)).toBe(1)

    const loser = aWon ? b : a
    const loserClaims = await loser.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:claims') || '{}'))
    expect(Object.keys(loserClaims)).toHaveLength(0)

    await providerContext.close()
    await claimantAContext.close()
    await claimantBContext.close()
  })
})
