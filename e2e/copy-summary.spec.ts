import { expect, test, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function ensureIdentity(page: Page, label: string) {
  const heading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await heading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: 'Save & Post', exact: true }).click()
  }
}

async function postBait(page: Page, label: string, berth: string, quantity = '3') {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await ensureIdentity(page, label)
  await page.getByRole('button', { name: 'BAIT', exact: true }).click()
  await page.getByLabel('Quantity').fill(quantity)
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
}

async function installClipboardRecorder(page: Page, delayMs = 0) {
  await page.evaluate((delay) => {
    ;(window as typeof window & { __jettyCopied?: string; __jettyCopyWrites?: number }).__jettyCopied = ''
    ;(window as typeof window & { __jettyCopied?: string; __jettyCopyWrites?: number }).__jettyCopyWrites = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          const target = window as typeof window & { __jettyCopied?: string; __jettyCopyWrites?: number }
          target.__jettyCopied = text
          target.__jettyCopyWrites = (target.__jettyCopyWrites ?? 0) + 1
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        },
        readText: async () => (window as typeof window & { __jettyCopied?: string }).__jettyCopied ?? '',
      },
    })
  }, delayMs)
}

async function mockHealthySnapshot(page: Page) {
  let calls = 0
  await page.routeWebSocket('**/realtime/v1/websocket**', async () => {
    // Keep Realtime isolated in this controller test so only explicit snapshot reads are counted.
  })
  await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
    calls += 1
    const now = Date.now()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server_now: new Date(now).toISOString(),
        next_transition_at: new Date(now + 30 * 60_000).toISOString(),
        items: [{
          id: '70000000-0000-4000-8000-000000000001',
          item_type: 'ICE',
          quantity_value: 5,
          quantity_unit: 'KG',
          berth: 'COPY-01',
          poster_label: 'Hidden Provider Label',
          created_at: new Date(now - 60_000).toISOString(),
          expires_at: new Date(now + 30 * 60_000).toISOString(),
        }],
      }),
    })
  })
  return {
    calls: () => calls,
    reset: () => { calls = 0 },
  }
}

test.describe('Component 07 copy-summary release gates', () => {
  test('clipboard denial preserves the exact text in a readable/selectable 360px manual-copy sheet', async ({ browser }) => {
    const id = suffix()
    const berth = `M${id}`.slice(0, 12)
    const providerLabel = `QA Copy Provider ${id}`
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const page = await context.newPage()

    await page.goto('/')
    await postBait(page, providerLabel, berth)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => { throw new DOMException('Clipboard blocked for QA', 'NotAllowedError') },
          readText: async () => '',
        },
      })
    })

    const copyButton = page.getByRole('button', { name: 'Copy all available supplies', exact: true })
    await expect(copyButton).toHaveAttribute('aria-busy', 'false')
    const copyBox = await copyButton.boundingBox()
    expect(copyBox && copyBox.height >= 44).toBeTruthy()
    await copyButton.click()

    const fallback = page.getByRole('dialog', { name: 'Copy supply summary' })
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('Clipboard access is unavailable')

    const textarea = fallback.getByLabel('Supply summary text')
    const text = await textarea.inputValue()
    expect(text).toContain('JETTYSHARE - SUPPLIES AVAILABLE NOW')
    expect(text).toContain(`BAIT | 3 buckets | Berth ${berth}`)
    expect(text).toContain('Live board: http://127.0.0.1:3000/')
    expect(text).toContain('Availability changes quickly - check the live board before pickup.')
    expect(text).not.toContain(providerLabel)
    expect(text).not.toContain('claim_version')
    expect(text).not.toContain('claim_token')

    const fontSize = await textarea.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(14)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)

    await fallback.getByRole('button', { name: 'Select all', exact: true }).click()
    const selection = await textarea.evaluate((element: HTMLTextAreaElement) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      length: element.value.length,
    }))
    expect(selection.start).toBe(0)
    expect(selection.end).toBe(selection.length)
    await context.close()
  })

  test('visual Ice filter never scopes Copy All and copied text uses canonical root/public fields only', async ({ browser }) => {
    const id = suffix()
    const berth = `F${id}`.slice(0, 12)
    const providerLabel = `QA Filter Copy ${id}`
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/?filter=ICE#not-part-of-copy')
    await postBait(page, providerLabel, berth, '6')
    await page.getByRole('button', { name: 'Ice', exact: true }).click()
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    await installClipboardRecorder(page)
    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    await expect(page.getByText(/available suppl(?:y|ies) copied\./i)).toBeVisible()

    const copied = await page.evaluate(() => (window as typeof window & { __jettyCopied?: string }).__jettyCopied ?? '')
    expect(copied).toContain(`BAIT | 6 buckets | Berth ${berth}`)
    expect(copied).toContain('Live board: http://127.0.0.1:3000/')
    expect(copied).not.toContain('?filter=ICE')
    expect(copied).not.toContain('#not-part-of-copy')
    expect(copied).not.toContain(providerLabel)
    expect(copied.toLowerCase()).not.toContain('claimant')
    expect(copied.toLowerCase()).not.toContain('capability')
    await context.close()
  })

  test('degraded refresh never silently copies stale data and offers retry plus explicitly labelled last-known fallback', async ({ browser }) => {
    const id = suffix()
    const berth = `L${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/')
    await postBait(page, `QA Last Known ${id}`, berth, '2')

    await page.route('**/rest/v1/rpc/get_board_snapshot', async (route) => {
      await route.abort('failed')
    })

    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText(/UPDATES MAY BE DELAYED/)).toBeVisible()

    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    await expect(page.getByText('Refresh failed. Last-known text is not current.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry refresh', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'View last-known text', exact: true }).click()

    const fallback = page.getByRole('dialog', { name: 'Last-known supply summary' })
    await expect(fallback).toBeVisible()
    await expect(fallback.getByRole('button', { name: 'Retry refresh', exact: true })).toBeVisible()
    const text = await fallback.getByLabel('Supply summary text').inputValue()
    expect(text).toContain('LAST KNOWN - JETTYSHARE SUPPLIES')
    expect(text).not.toContain('JETTYSHARE - SUPPLIES AVAILABLE NOW')
    expect(text).toContain('may be outdated')
    expect(text).toContain(`Berth ${berth}`)
    await context.close()
  })

  test('healthy snapshot at most 60 seconds old copies locally without another authoritative board read', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const reads = await mockHealthySnapshot(page)

    await page.goto('/')
    await expect(page.getByText('BERTH COPY-01', { exact: true })).toBeVisible()
    await installClipboardRecorder(page)
    reads.reset()

    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('1 available supply copied.')
    expect(reads.calls()).toBe(0)
    await context.close()
  })

  test('snapshot older than 60 seconds performs exactly one authoritative refresh before normal copy', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const reads = await mockHealthySnapshot(page)

    await page.goto('/')
    await expect(page.getByText('BERTH COPY-01', { exact: true })).toBeVisible()
    await installClipboardRecorder(page)
    reads.reset()
    await page.evaluate(() => {
      const advanced = Date.now() + 61_000
      Date.now = () => advanced
    })

    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('1 available supply copied.')
    expect(reads.calls()).toBe(1)
    await context.close()
  })

  test('double tap while copy is pending performs only one clipboard write', async ({ browser }) => {
    const id = suffix()
    const berth = `X${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/')
    await postBait(page, `QA Copy Lock ${id}`, berth, '4')
    await installClipboardRecorder(page, 400)

    const button = page.getByRole('button', { name: 'Copy all available supplies', exact: true })
    await button.evaluate((element: HTMLButtonElement) => {
      element.click()
      element.click()
    })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByText(/available suppl(?:y|ies) copied\./i)).toBeVisible()
    const writes = await page.evaluate(() => (window as typeof window & { __jettyCopyWrites?: number }).__jettyCopyWrites ?? 0)
    expect(writes).toBe(1)
    await context.close()
  })
})
