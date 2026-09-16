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

test.describe('Component 07 copy-summary release gates', () => {
  test('clipboard denial preserves the exact text in a readable/selectable manual-copy sheet', async ({ browser }) => {
    const id = suffix()
    const berth = `M${id}`.slice(0, 12)
    const providerLabel = `QA Copy Provider ${id}`
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
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

    await page.getByRole('button', { name: /Copy all available/i }).click()
    const fallback = page.getByRole('dialog', { name: 'Copy supply summary' })
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('Clipboard access is unavailable')

    const textarea = fallback.getByLabel('Supply summary text')
    const text = await textarea.inputValue()
    expect(text).toContain(`BAIT | 3 buckets | Berth ${berth}`)
    expect(text).toContain('Live board: http://127.0.0.1:3000/')
    expect(text).not.toContain(providerLabel)
    expect(text).not.toContain('claim_version')
    expect(text).not.toContain('claim_token')

    const fontSize = await textarea.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(14)

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

  test('degraded refresh never silently copies stale data and offers an explicitly labelled last-known fallback', async ({ browser }) => {
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

    await page.getByRole('button', { name: /Copy all available/i }).click()
    await expect(page.getByText('Refresh failed. Last-known text is not current.')).toBeVisible()
    await page.getByRole('button', { name: 'View last-known text', exact: true }).click()

    const fallback = page.getByRole('dialog', { name: 'Last-known supply summary' })
    await expect(fallback).toBeVisible()
    const text = await fallback.getByLabel('Supply summary text').inputValue()
    expect(text).toContain('LAST KNOWN - JETTYSHARE SUPPLIES')
    expect(text).toContain('may be outdated')
    expect(text).toContain(`Berth ${berth}`)
    await context.close()
  })

  test('double tap while copy is pending performs only one clipboard write', async ({ browser }) => {
    const id = suffix()
    const berth = `X${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/')
    await postBait(page, `QA Copy Lock ${id}`, berth, '4')

    await page.evaluate(() => {
      ;(window as typeof window & { __jettyCopyWrites?: number }).__jettyCopyWrites = 0
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            const target = window as typeof window & { __jettyCopyWrites?: number }
            target.__jettyCopyWrites = (target.__jettyCopyWrites ?? 0) + 1
            await new Promise((resolve) => setTimeout(resolve, 400))
          },
          readText: async () => '',
        },
      })
    })

    const button = page.getByRole('button', { name: /Copy all available/i })
    await button.evaluate((element: HTMLButtonElement) => {
      element.click()
      element.click()
    })
    await expect(page.getByText(/available suppl(?:y|ies) copied\./i)).toBeVisible()
    const writes = await page.evaluate(() => (window as typeof window & { __jettyCopyWrites?: number }).__jettyCopyWrites ?? 0)
    expect(writes).toBe(1)
    await context.close()
  })
})
