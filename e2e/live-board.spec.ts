import { expect, test, type Page } from '@playwright/test'

type BoardItem = {
  id: string
  item_type: 'ICE' | 'BAIT'
  quantity_value: number
  quantity_unit: 'KG' | 'BUCKET' | 'TRAY' | 'BOX'
  berth: string
  poster_label: string
  created_at: string
  expires_at: string
}

function boardSnapshot(serverNowMs: number, items: BoardItem[], nextTransitionAt: string | null = null) {
  return {
    server_now: new Date(serverNowMs).toISOString(),
    next_transition_at: nextTransitionAt,
    items,
  }
}

function item(overrides: Partial<BoardItem> & Pick<BoardItem, 'id' | 'berth' | 'expires_at'>): BoardItem {
  return {
    id: overrides.id,
    item_type: overrides.item_type ?? 'ICE',
    quantity_value: overrides.quantity_value ?? 8,
    quantity_unit: overrides.quantity_unit ?? 'KG',
    berth: overrides.berth,
    poster_label: overrides.poster_label ?? 'QA Board Crew',
    created_at: overrides.created_at ?? new Date(Date.now() - 60_000).toISOString(),
    expires_at: overrides.expires_at,
  }
}

async function blockRealtime(page: Page) {
  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime intentionally unavailable for Component 04 QA' })
  })
}

async function fulfillSnapshot(page: Page, snapshot: ReturnType<typeof boardSnapshot>) {
  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    })
  })
}

test.describe('Component 04 Live Board release gates', () => {
  test('public browsing, authoritative order, local filters, plain labels and accessible card text', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await blockRealtime(page)

    const now = Date.now()
    const rows = [
      item({
        id: '00000000-0000-4000-8000-000000000001',
        berth: 'A1',
        item_type: 'BAIT',
        quantity_value: 2,
        quantity_unit: 'BUCKET',
        poster_label: '<b>Unverified Crew</b>',
        created_at: new Date(now - 30_000).toISOString(),
        expires_at: new Date(now + 8 * 60_000).toISOString(),
      }),
      item({
        id: '00000000-0000-4000-8000-000000000002',
        berth: 'A2',
        item_type: 'ICE',
        quantity_value: 10,
        quantity_unit: 'KG',
        created_at: new Date(now - 20_000).toISOString(),
        expires_at: new Date(now + 20 * 60_000).toISOString(),
      }),
      item({
        id: '00000000-0000-4000-8000-000000000003',
        berth: 'A3',
        item_type: 'ICE',
        quantity_value: 3,
        quantity_unit: 'BOX',
        created_at: new Date(now - 10_000).toISOString(),
        expires_at: new Date(now + 45 * 60_000).toISOString(),
      }),
    ]
    await fulfillSnapshot(page, boardSnapshot(now, rows))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'JettyShare' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What should crews call your boat?' })).toHaveCount(0)

    const cards = page.locator('.supply-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toContainText('BERTH A1')
    await expect(cards.nth(1)).toContainText('BERTH A2')
    await expect(cards.nth(2)).toContainText('BERTH A3')

    const firstLabel = await cards.nth(0).getAttribute('aria-label')
    expect(firstLabel).toMatch(/BAIT 2 buckets at berth A1, urgent, .*left/i)
    await expect(cards.nth(0).getByText('Posted by <b>Unverified Crew</b>')).toBeVisible()
    await expect(cards.nth(0).locator('b')).toHaveCount(0)

    await page.getByRole('button', { name: 'Ice', exact: true }).click()
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('BERTH A2')
    await expect(cards.nth(1)).toContainText('BERTH A3')

    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(cards).toHaveCount(3)
    await context.close()
  })

  test('device clock skew still displays countdown from snapshot server time', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await blockRealtime(page)

    const clientNow = Date.now()
    const serverNow = clientNow + 60 * 60_000
    const expires = new Date(serverNow + 8 * 60_000 + 42_000).toISOString()
    await fulfillSnapshot(page, boardSnapshot(serverNow, [item({
      id: '00000000-0000-4000-8000-000000000004',
      berth: 'CLOCK',
      expires_at: expires,
    })]))

    await page.goto('/')
    const card = page.locator('.supply-card', { hasText: 'BERTH CLOCK' })
    await expect(card).toBeVisible()
    await expect(card.locator('.status').first()).toContainText(/URGENT · 8m \d{2}s left/)
    await context.close()
  })

  test('initial snapshot failure shows Retry and never invents inventory', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await blockRealtime(page)

    const now = Date.now()
    let requests = 0
    await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      requests += 1
      if (requests === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary QA failure' }) })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(boardSnapshot(now, [item({
          id: '00000000-0000-4000-8000-000000000005',
          berth: 'RETRY',
          expires_at: new Date(now + 30 * 60_000).toISOString(),
        })])),
      })
    })

    await page.goto('/')
    await expect(page.getByText('Could not load supplies. Check connection.')).toBeVisible()
    await expect(page.locator('.supply-card')).toHaveCount(0)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('.supply-card', { hasText: 'BERTH RETRY' })).toBeVisible()
    await context.close()
  })

  test('background read failure retains last-good board and recovery clears degraded warning', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await blockRealtime(page)

    const now = Date.now()
    const good = boardSnapshot(now, [item({
      id: '00000000-0000-4000-8000-000000000006',
      berth: 'STABLE',
      expires_at: new Date(now + 30 * 60_000).toISOString(),
    })])
    let fail = false
    await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      if (fail) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary QA failure' }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(good) })
      }
    })

    await page.goto('/')
    const card = page.locator('.supply-card', { hasText: 'BERTH STABLE' })
    await expect(card).toBeVisible()

    fail = true
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText(/UPDATES MAY BE DELAYED/)).toBeVisible()
    await expect(card).toBeVisible()

    fail = false
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText(/UPDATES MAY BE DELAYED/)).toHaveCount(0)
    await expect(card).toBeVisible()
    await context.close()
  })

  test('next_transition removes an expired card and causes authoritative reconciliation', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await blockRealtime(page)

    const now = Date.now()
    const transition = new Date(now + 1800).toISOString()
    let requests = 0
    await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      requests += 1
      const payload = requests === 1
        ? boardSnapshot(now, [item({
            id: '00000000-0000-4000-8000-000000000007',
            berth: 'EXP',
            expires_at: transition,
          })], transition)
        : boardSnapshot(Date.now(), [])
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    })

    await page.goto('/')
    await expect(page.locator('.supply-card', { hasText: 'BERTH EXP' })).toBeVisible()
    await expect(page.locator('.supply-card', { hasText: 'BERTH EXP' })).toHaveCount(0, { timeout: 6000 })
    expect(requests).toBeGreaterThanOrEqual(2)
    await context.close()
  })

  test('own listing is marked without Claim and roughly thirty rows stay usable at 360px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const ownId = '00000000-0000-4000-8000-000000000008'
    await context.addInitScript((listingId) => {
      localStorage.setItem('jettyshare:v1:owned-listings', JSON.stringify({
        [listingId]: { ownerToken: 'qa-owner-token', state: 'managed', createdLocallyAt: new Date().toISOString() },
      }))
    }, ownId)
    const page = await context.newPage()
    await blockRealtime(page)

    const now = Date.now()
    const rows = Array.from({ length: 30 }, (_, index) => item({
      id: index === 0 ? ownId : `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      berth: `B${String(index + 1).padStart(2, '0')}`,
      quantity_value: index + 1,
      expires_at: new Date(now + (index + 10) * 60_000).toISOString(),
      created_at: new Date(now - index * 1000).toISOString(),
    }))
    await fulfillSnapshot(page, boardSnapshot(now, rows))

    await page.goto('/')
    await expect(page.locator('.supply-card')).toHaveCount(30)
    const ownCard = page.locator('.supply-card', { hasText: 'BERTH B01' })
    await expect(ownCard.getByText('YOUR POST')).toBeVisible()
    await expect(ownCard.getByRole('button', { name: /Claim/ })).toHaveCount(0)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
    await expect(page.locator('img')).toHaveCount(0)
    await context.close()
  })
})
