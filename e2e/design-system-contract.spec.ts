import { expect, test, type Page } from '@playwright/test'

async function openPostSheet(page: Page) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  const identity = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await identity.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill('QA Design Crew')
    await page.getByRole('button', { name: 'Save & Post', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeVisible()
}

async function mockUrgentBoard(page: Page) {
  await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
    await ws.close({ code: 1001, reason: 'Realtime isolated for Component 08 presentation QA' })
  })
  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    const now = Date.now()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server_now: new Date(now).toISOString(),
        next_transition_at: new Date(now + 5 * 60_000).toISOString(),
        items: [{
          id: '80000000-0000-4000-8000-000000000001',
          item_type: 'ICE',
          quantity_value: 25,
          quantity_unit: 'KG',
          berth: '08',
          poster_label: 'A'.repeat(40),
          created_at: new Date(now - 60_000).toISOString(),
          expires_at: new Date(now + 5 * 60_000).toISOString(),
        }],
      }),
    })
  })
}

function contrastRatio(rgbA: number[], rgbB: number[]) {
  const luminance = (rgb: number[]) => {
    const channels = rgb.map((value) => {
      const v = value / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const a = luminance(rgbA)
  const b = luminance(rgbB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function parseRgb(value: string) {
  const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
  if (values.length !== 3) throw new Error(`Could not parse RGB value: ${value}`)
  return values
}

test.describe('Component 08 frozen design-system contract', () => {
  test('persistent labels, 3px focus ring, associated danger validation and 48px primary target survive at 360px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const page = await context.newPage()
    await page.goto('/')
    await openPostSheet(page)

    const quantity = page.getByLabel('Quantity')
    const berth = page.getByLabel('Pickup berth')
    await quantity.fill('12.5')
    await berth.fill('08')
    await expect(page.locator('label', { hasText: 'Quantity' })).toBeVisible()
    await expect(page.locator('label', { hasText: 'Pickup berth' })).toBeVisible()

    await quantity.focus()
    const focus = await quantity.evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle }
    })
    expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(3)
    expect(parseFloat(focus.offset)).toBeGreaterThanOrEqual(2)
    expect(focus.style).not.toBe('none')

    const primary = page.getByRole('button', { name: 'Post supply', exact: true })
    const box = await primary.boundingBox()
    expect(box && box.height >= 48).toBeTruthy()

    await quantity.fill('0')
    await primary.click()
    await expect(quantity).toBeFocused()
    await expect(quantity).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await quantity.getAttribute('aria-describedby')
    expect(describedBy).toBe('quantity-error')
    await expect(page.locator('#quantity-error')).toContainText('ERROR · Enter a positive quantity')
    const invalidBorder = await quantity.evaluate((element) => getComputedStyle(element).borderColor)
    expect(invalidBorder).toBe('rgb(139, 30, 30)')

    const sheetPadding = await page.locator('.sheet').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
    expect(sheetPadding).toBeGreaterThanOrEqual(24)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
    await context.close()
  })

  test('urgency, filter state, countdown meaning and long identity remain semantic without color or decorative icon', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const page = await context.newPage()
    await mockUrgentBoard(page)
    await page.goto('/')

    const card = page.locator('.supply-card', { hasText: 'BERTH 08' })
    await expect(card).toBeVisible()
    await expect(card.getByText(/URGENT/)).toBeVisible()
    await expect(card.getByText('25 kg', { exact: true })).toBeVisible()
    await expect(card.getByText('BERTH 08', { exact: true })).toBeVisible()
    await expect(card.locator('[aria-live]')).toHaveCount(0)

    const all = page.getByRole('button', { name: 'All', exact: true })
    const ice = page.getByRole('button', { name: 'Ice', exact: true })
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect(ice).toHaveAttribute('aria-pressed', 'false')
    await ice.click()
    await expect(ice).toHaveAttribute('aria-pressed', 'true')

    await card.locator('.item-icon').evaluate((element) => element.remove())
    await expect(card.getByRole('heading', { name: 'ICE' })).toBeVisible()
    await expect(card.getByText(/URGENT/)).toBeVisible()
    await expect(card.getByText('BERTH 08', { exact: true })).toBeVisible()

    const longLabel = card.locator('.posted-by')
    await expect(longLabel).toContainText('A'.repeat(40))
    const labelGeometry = await longLabel.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(labelGeometry.scrollWidth).toBeLessThanOrEqual(labelGeometry.clientWidth + 1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
    await context.close()
  })

  test('essential text, primary action and control boundary meet frozen contrast targets', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await mockUrgentBoard(page)
    await page.goto('/')

    const claim = page.locator('.supply-card .button-primary')
    const filter = page.getByRole('button', { name: 'All', exact: true })
    await expect(claim).toBeVisible()
    await expect(filter).toBeVisible()

    const bodyValues = await page.locator('body').evaluate((element) => {
      const style = getComputedStyle(element)
      return { text: style.color, background: style.backgroundColor }
    })
    const claimValues = await claim.evaluate((element) => {
      const style = getComputedStyle(element)
      return { text: style.color, background: style.backgroundColor }
    })
    const filterValues = await filter.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor }
    })

    expect(contrastRatio(parseRgb(bodyValues.text), parseRgb(bodyValues.background))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseRgb(claimValues.text), parseRgb(claimValues.background))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseRgb(filterValues.background), parseRgb(bodyValues.background))).toBeGreaterThanOrEqual(3)
    await context.close()
  })

  test('initial loading remains concise text and never invents skeleton inventory', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const page = await context.newPage()
    await page.routeWebSocket('**/realtime/v1/websocket**', async (ws) => {
      await ws.close({ code: 1001, reason: 'Realtime isolated for loading QA' })
    })
    await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ server_now: new Date().toISOString(), next_transition_at: null, items: [] }),
      })
    })

    await page.goto('/')
    await expect(page.getByText('Loading available supplies…', { exact: true })).toBeVisible()
    await expect(page.locator('.supply-card')).toHaveCount(0)
    await expect(page.getByText('No supplies available right now.', { exact: true })).toBeVisible({ timeout: 5_000 })
    await context.close()
  })

  test('360px reflow proxy for a 720px window at 200% preserves core hierarchy without overlap or clipping', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 700 } })
    const page = await context.newPage()
    await mockUrgentBoard(page)
    await page.goto('/')

    const keyRects = await page.evaluate(() => {
      const selectors = ['.topbar', '.board-tools', '.section-heading', '.supply-card', '.floating-post']
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return { selector, left: rect.left, right: rect.right, width: rect.width }
      }).filter(Boolean)
    }) as Array<{ selector: string; left: number; right: number; width: number }>

    for (const rect of keyRects) {
      expect(rect.left).toBeGreaterThanOrEqual(-1)
      expect(rect.right).toBeLessThanOrEqual(361)
      expect(rect.width).toBeGreaterThan(0)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
    await context.close()
  })
})
