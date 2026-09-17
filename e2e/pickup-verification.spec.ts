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

async function postSupply(page: Page, label: string, berth: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await saveIdentityIfNeeded(page, label, 'Save & Post')
  await page.getByLabel('Quantity').fill('8.5')
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '15m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
  await expect(page.getByText(`BERTH ${berth}`, { exact: true }).first()).toBeVisible()
}

function activitySection(page: Page, heading: 'My Posts' | 'My Claims') {
  return page.locator('.activity-section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
}

test('pickup verification binds the physical handoff to the claimant session and gates collection server-side', async ({ browser }) => {
  const id = suffix()
  const berth = `V${id}`.slice(0, 12)
  const providerLabel = `QA Verify Provider ${id}`
  const claimantLabel = `QA Verify Claimant ${id}`

  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const provider = await providerContext.newPage()
  const claimant = await claimantContext.newPage()

  try {
    await provider.goto('/')
    await claimant.goto('/')
    await postSupply(provider, providerLabel, berth)

    const claimantCard = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(claimantCard).toBeVisible({ timeout: 20_000 })
    await claimantCard.getByRole('button', { name: /Claim/ }).click()
    await saveIdentityIfNeeded(claimant, claimantLabel, 'Save & Claim')

    const receipt = claimant.getByRole('dialog', { name: 'Supply claimed' })
    await expect(receipt).toBeVisible({ timeout: 20_000 })
    const codePanel = receipt.locator('[aria-label="Pickup verification code"]')
    await expect(codePanel.getByText('PICKUP CODE', { exact: true })).toBeVisible()
    const pickupCode = (await codePanel.locator('.quantity').textContent())?.trim() ?? ''
    expect(pickupCode).toMatch(/^\d{4}$/)
    await receipt.getByRole('button', { name: 'Done — back to board', exact: true }).click()

    // The claimant can recover the same short proof after a hard refresh because
    // claim authority is already persisted locally and the server receipt is capability-gated.
    await claimant.reload()
    await claimant.getByRole('button', { name: 'Activity', exact: true }).click()
    const claimantActivity = activitySection(claimant, 'My Claims').locator('.managed-card', { hasText: `BERTH ${berth}` })
    await expect(claimantActivity).toBeVisible({ timeout: 20_000 })
    await expect(claimantActivity.getByText(pickupCode, { exact: true })).toBeVisible()
    await claimant.getByRole('button', { name: 'Close', exact: true }).click()

    await provider.getByRole('button', { name: 'Activity', exact: true }).click()
    const managedPost = activitySection(provider, 'My Posts').locator('.managed-card', { hasText: `BERTH ${berth}` })
    await expect(managedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible({ timeout: 20_000 })

    // Provider management never receives/displays the expected code before the
    // claimant supplies it. Collection is disabled until verification succeeds.
    await expect(managedPost.getByText(pickupCode, { exact: true })).toHaveCount(0)
    const confirm = managedPost.getByRole('button', { name: 'Confirm collected', exact: true })
    await expect(confirm).toBeDisabled()

    const input = managedPost.getByLabel(`Pickup code for berth ${berth}`)
    const wrongCode = pickupCode === '0000' ? '0001' : '0000'
    await input.fill(wrongCode)
    await managedPost.getByRole('button', { name: 'Verify pickup code', exact: true }).click()
    await expect(provider.getByText(/Pickup code does not match the current reservation/i)).toBeVisible()
    await expect(confirm).toBeDisabled()

    await input.fill(pickupCode)
    await managedPost.getByRole('button', { name: 'Verify pickup code', exact: true }).click()
    await expect(managedPost.getByText(/Collector verified — safe to hand over/i)).toBeVisible()
    await expect(confirm).toBeEnabled()

    let collectedBody: Record<string, unknown> | null = null
    provider.on('request', (request) => {
      if (request.url().includes('/rest/v1/rpc/confirm_collected') && request.method() === 'POST') {
        collectedBody = request.postDataJSON() as Record<string, unknown>
      }
    })

    provider.once('dialog', (dialog) => dialog.accept())
    await confirm.click()
    await expect(managedPost).toHaveCount(0, { timeout: 20_000 })
    expect(collectedBody).toMatchObject({ p_pickup_code: pickupCode })
    const providerHistory = provider.locator('[aria-label="Recent activity"] .managed-card', { hasText: `BERTH ${berth}` })
    await expect(providerHistory.getByText('COLLECTED', { exact: true })).toBeVisible()

    await provider.getByRole('button', { name: 'Close', exact: true }).click()
    await claimant.reload()
    await expect(claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(0, { timeout: 20_000 })
  } finally {
    await providerContext.close()
    await claimantContext.close()
  }
})
