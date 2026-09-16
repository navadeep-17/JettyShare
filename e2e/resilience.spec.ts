import { expect, test, type BrowserContext, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function openPostFor(page: Page, crewLabel: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  const identityHeading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await identityHeading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(crewLabel)
    await page.getByRole('button', { name: 'Save & Post', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeVisible()
}

async function postSupply(page: Page, crewLabel: string, berth: string, quantity = '8') {
  await openPostFor(page, crewLabel)
  await page.getByLabel('Quantity').fill(quantity)
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
  await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
}

async function blockRealtime(page: Page) {
  // Route only Supabase Realtime sockets. Unlike replacing window.WebSocket,
  // this preserves normal application startup while simulating a disconnected
  // broadcast channel. HTTP snapshot RPCs remain fully available.
  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime intentionally unavailable for JettyShare QA' })
  })
}

async function emulateSlow3G(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 800,
    downloadThroughput: 50 * 1024 / 8,
    uploadThroughput: 20 * 1024 / 8,
    connectionType: 'cellular3g',
  })
  return session
}

test.describe('JettyShare recovery and slow-network release gates', () => {
  test('slow-3G post keeps one stable pending action under a double tap', async ({ browser }) => {
    const id = suffix()
    const berth = `G${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    let createRequests = 0

    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/rpc/create_listing')) createRequests += 1
    })

    await page.goto('/')
    await openPostFor(page, `QA Slow3G ${id}`)
    await page.getByLabel('Quantity').fill('11')
    await page.getByLabel('Pickup berth').fill(berth)
    await page.getByRole('button', { name: '15m', exact: true }).click()

    const session = await emulateSlow3G(context, page)
    await page.getByRole('button', { name: 'Post supply', exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })

    const pending = page.getByRole('button', { name: 'Posting…', exact: true })
    await expect(pending).toBeVisible()
    await expect(pending).toBeDisabled()
    await expect(page.getByText('Pending post is locked to its original details so retry cannot create a duplicate.')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden({ timeout: 25_000 })
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(1)
    expect(createRequests).toBe(1)

    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none',
    })
    await context.close()
  })

  test('missing Realtime still converges through focus snapshot refresh', async ({ browser }) => {
    const id = suffix()
    const berth = `R${id}`.slice(0, 12)
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const provider = await providerContext.newPage()
    const viewer = await viewerContext.newPage()

    await blockRealtime(viewer)
    await provider.goto('/')
    await viewer.goto('/')
    await expect(viewer.getByRole('heading', { name: 'JettyShare' })).toBeVisible()

    await postSupply(provider, `QA Realtime ${id}`, berth)
    await expect(viewer.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    // Focus recovery is one of the frozen fallback paths when a broadcast is missed.
    await viewer.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(viewer.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible({ timeout: 12_000 })

    await providerContext.close()
    await viewerContext.close()
  })

  test('an older delayed board response cannot resurrect a claimed listing', async ({ browser }) => {
    const id = suffix()
    const berth = `O${id}`.slice(0, 12)
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const provider = await providerContext.newPage()
    const viewer = await viewerContext.newPage()
    const claimant = await claimantContext.newPage()

    await blockRealtime(viewer)
    await provider.goto('/')
    await postSupply(provider, `QA Ordering ${id}`, berth)
    await viewer.goto('/')
    await claimant.goto('/')
    await expect(viewer.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
    await expect(claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()

    let firstSnapshotCaptured!: () => void
    const captured = new Promise<void>((resolve) => { firstSnapshotCaptured = resolve })
    let releaseOldResponse!: () => void
    const releaseOld = new Promise<void>((resolve) => { releaseOldResponse = resolve })
    let snapshotRequests = 0

    await viewer.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      snapshotRequests += 1
      if (snapshotRequests === 1) {
        const oldResponse = await route.fetch()
        firstSnapshotCaptured()
        await releaseOld
        await route.fulfill({ response: oldResponse })
        return
      }
      await route.continue()
    })

    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click()
    await captured

    const claimCard = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await claimCard.getByRole('button', { name: /Claim/ }).click()
    const identityHeading = claimant.getByRole('heading', { name: 'What should crews call your boat?' })
    if (await identityHeading.isVisible().catch(() => false)) {
      await claimant.getByLabel('Boat / crew name').fill(`QA Ordering Claimant ${id}`)
      await claimant.getByRole('button', { name: 'Save & Claim', exact: true }).click()
    }
    await expect(claimant.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()

    // A second, newer snapshot sees the claimed item absent.
    await viewer.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(viewer.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    // Now release the stale response. The generation guard must ignore it.
    releaseOldResponse()
    await viewer.waitForTimeout(750)
    await expect(viewer.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    await providerContext.close()
    await viewerContext.close()
    await claimantContext.close()
  })
})
