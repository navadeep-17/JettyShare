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

async function postSupply(page: Page, label: string, berth: string, quantity = '8.5') {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await saveIdentityIfNeeded(page, label, 'Save & Post')
  await page.getByLabel('Quantity').fill(quantity)
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '15m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
  await expect(page.getByText(`BERTH ${berth}`, { exact: true }).first()).toBeVisible()
}

async function claimSupply(page: Page, label: string, berth: string) {
  const card = page.locator('.supply-card', { hasText: `BERTH ${berth}` })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole('button', { name: /Claim/ }).click()
  await saveIdentityIfNeeded(page, label, 'Save & Claim')
  const receipt = page.getByRole('dialog', { name: 'Supply claimed' })
  await expect(receipt).toBeVisible({ timeout: 20_000 })
  const code = (await receipt.locator('[aria-label="Pickup verification code"] .quantity').textContent())?.trim() ?? ''
  expect(code).toMatch(/^\d{4}$/)
  await receipt.getByRole('button', { name: 'Done — back to board', exact: true }).click()
  return code
}

async function openActivity(page: Page) {
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My Activity' })).toBeVisible()
}

test('completed handoff leaves redacted recent activity on both participating browsers', async ({ browser }) => {
  const id = suffix()
  const berth = `H${id}`.slice(0, 12)
  const providerLabel = `QA History Provider ${id}`
  const claimantLabel = `QA History Claimant ${id}`

  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const provider = await providerContext.newPage()
  const claimant = await claimantContext.newPage()

  try {
    await provider.goto('/')
    await claimant.goto('/')
    await postSupply(provider, providerLabel, berth)
    const pickupCode = await claimSupply(claimant, claimantLabel, berth)

    await openActivity(provider)
    const managedPost = provider.locator('.managed-card', { hasText: `BERTH ${berth}` }).first()
    await expect(managedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible({ timeout: 20_000 })
    const input = managedPost.getByLabel(`Pickup code for berth ${berth}`)
    await input.fill(pickupCode)
    await managedPost.getByRole('button', { name: 'Verify pickup code', exact: true }).click()
    await expect(managedPost.getByText(/Collector verified — safe to hand over/i)).toBeVisible()
    provider.once('dialog', (dialog) => dialog.accept())
    await managedPost.getByRole('button', { name: 'Confirm collected', exact: true }).click()
    await expect(managedPost).toHaveCount(0, { timeout: 20_000 })

    const providerHistory = provider.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${berth}` })
    await expect(providerHistory).toBeVisible()
    await expect(providerHistory.getByText('COLLECTED', { exact: true })).toBeVisible()
    await expect(providerHistory.getByText(/Last claimant:/)).toContainText(claimantLabel)

    await openActivity(claimant)
    const claimantHistory = claimant.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${berth}` })
    await expect(claimantHistory).toBeVisible({ timeout: 20_000 })
    await expect(claimantHistory.getByText('COLLECTED', { exact: true })).toBeVisible()
    await expect(claimantHistory.getByText(/From:/)).toContainText(providerLabel)
    await expect(claimant.getByText('No current claims on this device.')).toBeVisible()
  } finally {
    await providerContext.close()
    await claimantContext.close()
  }
})

test('provider can withdraw active or claimed supply and a claimant sees WITHDRAWN history', async ({ browser }) => {
  const id = suffix()
  const activeBerth = `W${id}`.slice(0, 12)
  const claimedBerth = `C${id}`.slice(0, 12)
  const providerLabel = `QA Withdraw Provider ${id}`
  const claimantLabel = `QA Withdraw Claimant ${id}`

  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const provider = await providerContext.newPage()
  const claimant = await claimantContext.newPage()

  try {
    await provider.goto('/')
    await claimant.goto('/')

    await postSupply(provider, providerLabel, activeBerth, '6')
    await openActivity(provider)
    const activePost = provider.locator('.managed-card', { hasText: `BERTH ${activeBerth}` }).first()
    await expect(activePost.getByText('ACTIVE', { exact: true })).toBeVisible()
    provider.once('dialog', (dialog) => dialog.accept())
    await activePost.getByRole('button', { name: 'Withdraw supply', exact: true }).click()
    await expect(activePost).toHaveCount(0, { timeout: 20_000 })
    const activeHistory = provider.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${activeBerth}` })
    await expect(activeHistory.getByText('WITHDRAWN', { exact: true })).toBeVisible()
    await provider.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(provider.locator('.supply-card', { hasText: `BERTH ${activeBerth}` })).toHaveCount(0, { timeout: 20_000 })

    await postSupply(provider, providerLabel, claimedBerth, '7')
    await claimSupply(claimant, claimantLabel, claimedBerth)
    await openActivity(provider)
    const claimedPost = provider.locator('.managed-card', { hasText: `BERTH ${claimedBerth}` }).first()
    await expect(claimedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible({ timeout: 20_000 })
    provider.once('dialog', (dialog) => dialog.accept())
    await claimedPost.getByRole('button', { name: 'Withdraw supply', exact: true }).click()
    await expect(claimedPost).toHaveCount(0, { timeout: 20_000 })
    const claimedHistory = provider.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${claimedBerth}` })
    await expect(claimedHistory.getByText('WITHDRAWN', { exact: true })).toBeVisible()

    await openActivity(claimant)
    const claimantHistory = claimant.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${claimedBerth}` })
    await expect(claimantHistory).toBeVisible({ timeout: 20_000 })
    await expect(claimantHistory.getByText('WITHDRAWN', { exact: true })).toBeVisible()
    await expect(claimant.getByText('No current claims on this device.')).toBeVisible()
    await claimant.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(claimant.locator('.supply-card', { hasText: `BERTH ${claimedBerth}` })).toHaveCount(0, { timeout: 20_000 })
  } finally {
    await providerContext.close()
    await claimantContext.close()
  }
})
