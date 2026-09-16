import { expect, test, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function saveIdentityIfNeeded(page: Page, label: string, submitText: 'Save & Post' | 'Save & Claim') {
  const heading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await heading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: submitText, exact: true }).click()
  }
}

async function postSupply(
  page: Page,
  label: string,
  berth: string,
  options: { item?: 'ICE' | 'BAIT'; quantity?: string; spoilButton?: string } = {},
) {
  const item = options.item ?? 'ICE'
  const quantity = options.quantity ?? '10'
  const spoilButton = options.spoilButton ?? '30m'

  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await saveIdentityIfNeeded(page, label, 'Save & Post')
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeVisible()

  if (item === 'BAIT') await page.getByRole('button', { name: 'BAIT', exact: true }).click()
  await page.getByLabel('Quantity').fill(quantity)
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: spoilButton, exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
  await expect(page.getByText(`BERTH ${berth}`, { exact: true }).first()).toBeVisible()
}

test.describe('JettyShare DEV mobile release gates', () => {
  test('two isolated boats complete post -> claim -> release -> reclaim -> collect -> copy', async ({ browser }) => {
    const id = suffix()
    const berth = `E${id}`.slice(0, 12)
    const shareBerth = `S${id}`.slice(0, 12)
    const providerLabel = `QA Provider ${id}`
    const claimantLabel = `QA Claimant ${id}`

    const providerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const provider = await providerContext.newPage()
    const claimant = await claimantContext.newPage()

    await provider.goto('/')
    await claimant.goto('/')
    await expect(provider.getByRole('heading', { name: 'JettyShare' })).toBeVisible()
    await expect(claimant.getByRole('heading', { name: 'JettyShare' })).toBeVisible()

    await postSupply(provider, providerLabel, berth, { quantity: '12.5' })

    const providerCard = provider.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(providerCard.getByText('YOUR POST')).toBeVisible()
    await expect(providerCard.getByRole('button', { name: /Claim/ })).toHaveCount(0)

    const claimantCard = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(claimantCard).toBeVisible()
    await claimantCard.getByRole('button', { name: /Claim/ }).click()
    await saveIdentityIfNeeded(claimant, claimantLabel, 'Save & Claim')

    const receipt = claimant.getByRole('dialog', { name: 'Supply claimed' })
    await expect(receipt).toBeVisible()
    await expect(receipt.getByText(`BERTH ${berth}`, { exact: true })).toBeVisible()
    await expect(receipt.getByText(`Provider: ${providerLabel} · Claimed as ${claimantLabel}`, { exact: true })).toBeVisible()
    await expect(receipt.getByText('HOLD ENDS', { exact: true })).toBeVisible()
    await expect(receipt.getByText('SPOILS', { exact: true })).toBeVisible()
    await receipt.getByRole('button', { name: 'Done — back to board', exact: true }).click()

    await expect(provider.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    await claimant.getByRole('button', { name: 'Activity', exact: true }).click()
    const claimActivity = claimant.locator('.managed-card', { hasText: `BERTH ${berth}` })
    await expect(claimActivity).toBeVisible()
    claimant.once('dialog', (dialog) => dialog.accept())
    await claimActivity.getByRole('button', { name: 'I can’t make it — release', exact: true }).click()
    await claimant.getByRole('button', { name: 'Close', exact: true }).click()

    await expect(provider.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
    await expect(claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()

    await claimant.locator('.supply-card', { hasText: `BERTH ${berth}` }).getByRole('button', { name: /Claim/ }).click()
    await expect(claimant.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()
    await claimant.getByRole('button', { name: 'Done — back to board', exact: true }).click()

    await provider.getByRole('button', { name: 'Activity', exact: true }).click()
    const managedPost = provider.locator('.managed-card', { hasText: `BERTH ${berth}` })
    await expect(managedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible()
    provider.once('dialog', (dialog) => dialog.accept())
    await managedPost.getByRole('button', { name: 'Confirm collected', exact: true }).click()
    await provider.getByRole('button', { name: 'Close', exact: true }).click()

    await expect(provider.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)
    await expect(claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

    // Keep one known supply available, then prove Copy All ignores the visual filter.
    await postSupply(provider, providerLabel, shareBerth, { item: 'BAIT', quantity: '3' })
    await provider.getByRole('button', { name: 'Ice', exact: true }).click()
    await expect(provider.locator('.supply-card', { hasText: `BERTH ${shareBerth}` })).toHaveCount(0)
    await provider.getByRole('button', { name: /Copy all available/i }).click()
    await expect(provider.getByText(/available supplies? copied\./i)).toBeVisible()
    const copied = await provider.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(`BAIT | 3 buckets | Berth ${shareBerth}`)
    expect(copied).toContain('Live board:')

    await providerContext.close()
    await claimantContext.close()
  })

  test('lost create response keeps one immutable post and exact retry recovers it', async ({ browser }) => {
    const id = suffix()
    const berth = `P${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    let intercepted = false

    await page.route('**/rest/v1/rpc/create_listing', async (route) => {
      if (intercepted) return route.continue()
      intercepted = true
      await route.fetch() // let PostgreSQL commit, then lose only the response
      await route.abort('failed')
    })

    await page.goto('/')
    await page.getByRole('button', { name: '+ Post', exact: true }).click()
    await saveIdentityIfNeeded(page, `QA Retry ${id}`, 'Save & Post')
    await page.getByLabel('Quantity').fill('9')
    await page.getByLabel('Pickup berth').fill(berth)
    await page.getByRole('button', { name: '15m', exact: true }).click()
    await page.getByRole('button', { name: 'Post supply', exact: true }).click()

    await expect(page.getByText(/Connection interrupted\. This exact post attempt is saved/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry same post', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Retry same post', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(1)

    await context.close()
  })

  test('lost winning claim response retries the same generation and still shows success', async ({ browser }) => {
    const id = suffix()
    const berth = `C${id}`.slice(0, 12)
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const provider = await providerContext.newPage()
    const claimant = await claimantContext.newPage()

    await provider.goto('/')
    await postSupply(provider, `QA Slow Provider ${id}`, berth, { quantity: '7' })

    let intercepted = false
    await claimant.route('**/rest/v1/rpc/claim_listing', async (route) => {
      if (intercepted) return route.continue()
      intercepted = true
      const response = await route.fetch() // first claim wins in DB
      expect(response.ok()).toBeTruthy()
      await route.abort('failed') // browser never receives the winning response
    })

    await claimant.goto('/')
    const card = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /Claim/ }).click()
    await saveIdentityIfNeeded(claimant, `QA Slow Claimant ${id}`, 'Save & Claim')

    await expect(claimant.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible({ timeout: 20_000 })
    await expect(claimant.getByText(`BERTH ${berth}`, { exact: true })).toBeVisible()
    expect(intercepted).toBeTruthy()

    await providerContext.close()
    await claimantContext.close()
  })
})
