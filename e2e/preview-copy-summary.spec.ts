import { expect, test, type Page } from '@playwright/test'

const isRemotePreview = Boolean(process.env.PLAYWRIGHT_BASE_URL)

test.skip(!isRemotePreview, 'Deployment-only checks run against the Vercel Preview origin.')

function suffix() {
  return Date.now().toString().slice(-6)
}

function deployedRoot(page: Page) {
  return `${new URL(page.url()).origin}/`
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

async function installClipboardRecorder(page: Page) {
  await page.evaluate(() => {
    ;(window as typeof window & { __jettyCopied?: string }).__jettyCopied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          ;(window as typeof window & { __jettyCopied?: string }).__jettyCopied = text
        },
        readText: async () => (window as typeof window & { __jettyCopied?: string }).__jettyCopied ?? '',
      },
    })
  })
}

test.describe('Vercel Preview copy-summary deployment gates', () => {
  test('clipboard denial keeps the exact manual fallback and deployed root at 360px', async ({ browser }) => {
    const id = suffix()
    const berth = `PM${id}`.slice(0, 12)
    const providerLabel = `Preview Copy ${id}`
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
    const page = await context.newPage()

    await page.goto('/')
    const root = deployedRoot(page)
    await postBait(page, providerLabel, berth)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => { throw new DOMException('Clipboard blocked for deployment QA', 'NotAllowedError') },
          readText: async () => '',
        },
      })
    })

    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    const fallback = page.getByRole('dialog', { name: 'Copy supply summary' })
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('Clipboard access is unavailable')

    const textarea = fallback.getByLabel('Supply summary text')
    const text = await textarea.inputValue()
    expect(text).toContain('JETTYSHARE - SUPPLIES AVAILABLE NOW')
    expect(text).toContain(`BAIT | 3 buckets | Berth ${berth}`)
    expect(text).toContain(`Live board: ${root}`)
    expect(text).not.toContain(providerLabel)
    expect(text).not.toContain('claim_version')
    expect(text).not.toContain('claim_token')

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

  test('Copy All ignores the visual filter and strips query/hash on the deployed root', async ({ browser }) => {
    const id = suffix()
    const berth = `PF${id}`.slice(0, 12)
    const providerLabel = `Preview Filter Copy ${id}`
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()

    await page.goto('/?filter=ICE#preview-copy')
    const root = deployedRoot(page)
    await postBait(page, providerLabel, berth, '6')
    await page.getByRole('button', { name: 'Ice', exact: true }).click()
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    await installClipboardRecorder(page)
    await page.getByRole('button', { name: 'Copy all available supplies', exact: true }).click()
    await expect(page.getByText(/available suppl(?:y|ies) copied\./i)).toBeVisible()

    const copied = await page.evaluate(() => (window as typeof window & { __jettyCopied?: string }).__jettyCopied ?? '')
    expect(copied).toContain(`BAIT | 6 buckets | Berth ${berth}`)
    expect(copied).toContain(`Live board: ${root}`)
    expect(copied).not.toContain('?filter=ICE')
    expect(copied).not.toContain('#preview-copy')
    expect(copied).not.toContain(providerLabel)
    expect(copied.toLowerCase()).not.toContain('claimant')
    expect(copied.toLowerCase()).not.toContain('capability')

    await context.close()
  })
})
