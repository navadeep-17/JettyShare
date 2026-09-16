import { expect, test, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function saveIdentityIfVisible(page: Page, label: string, action: 'Save & Post' | 'Save & Claim') {
  const heading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await heading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: action, exact: true }).click()
  }
}

async function postSupply(page: Page, label: string, berth: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await saveIdentityIfVisible(page, label, 'Save & Post')
  await page.getByLabel('Quantity').fill('5')
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
}

test('ambiguous slow claim never reports false failure/success and recovers the same persisted generation', async ({ browser }) => {
  const id = suffix()
  const berth = `A${id}`.slice(0, 12)
  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const provider = await providerContext.newPage()
  const claimant = await claimantContext.newPage()

  await provider.goto('/')
  await postSupply(provider, `QA Ambiguous Provider ${id}`, berth)

  let attempts = 0
  await claimant.route('**/rest/v1/rpc/claim_listing', async (route) => {
    attempts += 1
    if (attempts === 1) {
      const response = await route.fetch() // DB commits the winning generation.
      expect(response.ok()).toBeTruthy()
      await new Promise((resolve) => setTimeout(resolve, 900)) // slow/lost ACK
      await route.abort('failed')
      return
    }
    // The browser cannot distinguish a lost response from a failed request. Keep
    // the following retries ambiguous too, without creating another generation.
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.abort('failed')
  })

  await claimant.goto('/')
  const card = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /Claim/ }).click()
  await saveIdentityIfVisible(claimant, `QA Ambiguous Claimant ${id}`, 'Save & Claim')

  await expect(claimant.getByText(/checking claim status/i)).toBeVisible({ timeout: 12_000 })
  await expect(claimant.getByRole('dialog', { name: 'Supply claimed' })).toHaveCount(0)
  await expect(claimant.getByText('Someone just claimed this supply.')).toHaveCount(0)
  expect(attempts).toBe(3)

  const savedBeforeRecovery = await claimant.evaluate(() => {
    const raw = localStorage.getItem('jettyshare:v1:claims')
    return raw ? JSON.parse(raw) : null
  })
  expect(savedBeforeRecovery).toBeTruthy()
  const entries = Object.values(savedBeforeRecovery as Record<string, { state?: string; claimVersion?: string; claimToken?: string }>)
  expect(entries).toHaveLength(1)
  expect(entries[0]?.state).toBe('pending-claim')
  const generation = { version: entries[0]?.claimVersion, token: entries[0]?.claimToken }
  expect(generation.version).toBeTruthy()
  expect(generation.token).toBeTruthy()

  await claimant.unroute('**/rest/v1/rpc/claim_listing')
  await claimant.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(claimant.getByText(new RegExp(`Claim recovered — pickup at BERTH ${berth}`))).toBeVisible({ timeout: 12_000 })

  const savedAfterRecovery = await claimant.evaluate(() => {
    const raw = localStorage.getItem('jettyshare:v1:claims')
    return raw ? JSON.parse(raw) : null
  }) as Record<string, { state?: string; claimVersion?: string; claimToken?: string }>
  const recovered = Object.values(savedAfterRecovery)[0]
  expect(recovered.state).toBe('held')
  expect(recovered.claimVersion).toBe(generation.version)
  expect(recovered.claimToken).toBe(generation.token)
  await expect(claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0)

  await providerContext.close()
  await claimantContext.close()
})
