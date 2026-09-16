import { expect, test, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

async function openPost(page: Page, label: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  const identityHeading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await identityHeading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: 'Save & Post', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeVisible()
}

test.describe('Component 03 Quick Post acceptance gates', () => {
  test('quantity, berth and spoil validation enforce frozen boundaries and focus the first invalid control', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')
    await openPost(page, `QA Validation ${suffix()}`)

    const quantity = page.getByLabel('Quantity')
    const berth = page.getByLabel('Pickup berth')
    const submit = page.getByRole('button', { name: 'Post supply', exact: true })

    await quantity.fill('0')
    await berth.fill('ABCDEFGHIJKL')
    await page.getByRole('button', { name: '15m', exact: true }).click()
    await submit.click()
    await expect(page.getByText(/positive quantity with up to 2 decimal places/i)).toBeVisible()
    await expect(quantity).toBeFocused()

    await quantity.fill('-1')
    await submit.click()
    await expect(page.getByText(/positive quantity with up to 2 decimal places/i)).toBeVisible()

    await quantity.fill('1.234')
    await submit.click()
    await expect(page.getByText(/positive quantity with up to 2 decimal places/i)).toBeVisible()

    await quantity.fill('1.23')
    await berth.fill('ABCDEFGHIJKLM')
    await submit.click()
    await expect(page.getByText('ERROR · Berth must be 1–12 characters.', { exact: true })).toBeVisible()
    await expect(berth).toBeFocused()

    // Exactly 12 characters is accepted; no spoil default is implied when reopened.
    await berth.fill('ABCDEFGHIJKL')
    await page.getByRole('button', { name: 'Custom', exact: true }).click()
    const custom = page.getByLabel('Custom minutes')

    await custom.fill('4')
    await submit.click()
    await expect(page.getByText('ERROR · Enter 5 to 360 whole minutes.', { exact: true })).toBeVisible()
    await expect(custom).toBeFocused()

    await custom.fill('361')
    await submit.click()
    await expect(page.getByText('ERROR · Enter 5 to 360 whole minutes.', { exact: true })).toBeVisible()

    await custom.fill('360')
    await submit.click()
    await expect(page.getByRole('heading', { name: 'Share surplus supply' })).toBeHidden()
    await expect(page.getByText('BERTH ABCDEFGHIJKL', { exact: true }).first()).toBeVisible()
    await context.close()
  })

  test('item-specific defaults and units follow the frozen ICE/BAIT contract and preserve berth text', async ({ browser }) => {
    const id = suffix()
    const berth = `a-${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')
    await openPost(page, `QA Defaults ${id}`)

    await expect(page.getByRole('button', { name: 'ICE', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Unit')).toHaveValue('KG')
    await expect(page.getByLabel('Unit').locator('option')).toHaveText(['KG', 'BOX'])

    await page.getByRole('button', { name: 'BAIT', exact: true }).click()
    await expect(page.getByLabel('Unit')).toHaveValue('BUCKET')
    await expect(page.getByLabel('Unit').locator('option')).toHaveText(['BUCKET', 'TRAY', 'BOX'])

    await page.getByLabel('Quantity').fill('2')
    await page.getByLabel('Pickup berth').fill(berth)
    await page.getByRole('button', { name: '30m', exact: true }).click()
    await page.getByRole('button', { name: 'Post supply', exact: true }).click()
    const card = page.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(card).toBeVisible()
    await expect(card).toContainText('BAIT')
    await expect(card).toContainText('2 buckets')
    await context.close()
  })

  test('offline post preserves one immutable pending attempt and exact retry succeeds after reconnect', async ({ browser }) => {
    const id = suffix()
    const berth = `F${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')
    await openPost(page, `QA Offline ${id}`)

    await page.getByLabel('Quantity').fill('7')
    await page.getByLabel('Pickup berth').fill(berth)
    await page.getByRole('button', { name: '15m', exact: true }).click()

    await context.setOffline(true)
    await page.getByRole('button', { name: 'Post supply', exact: true }).click()
    await expect(page.getByText(/Connection interrupted\. This exact post attempt is saved/)).toBeVisible()
    await expect(page.getByText('Pending post is locked to its original details so retry cannot create a duplicate.')).toBeVisible()
    await expect(page.getByLabel('Quantity')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Retry same post', exact: true })).toBeVisible()

    const before = await page.evaluate(() => localStorage.getItem('jettyshare:v1:owned-listings'))
    expect(before).toBeTruthy()

    await context.setOffline(false)
    await page.getByRole('button', { name: 'Retry same post', exact: true }).click()
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toHaveCount(1)
    await context.close()
  })

  test('server INVALID_INPUT clears the rejected generation so corrected fields create a new safe attempt', async ({ browser }) => {
    const id = suffix()
    const berth = `V${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    let firstPayload: Record<string, unknown> | null = null

    await page.route('**/rest/v1/rpc/create_listing', async (route) => {
      if (!firstPayload) {
        firstPayload = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'P0001', message: 'INVALID_INPUT', details: null, hint: null }),
        })
        return
      }
      await route.continue()
    })

    await page.goto('/')
    await openPost(page, `QA Reject ${id}`)
    await page.getByLabel('Quantity').fill('5')
    await page.getByLabel('Pickup berth').fill(berth)
    await page.getByRole('button', { name: '15m', exact: true }).click()
    await page.getByRole('button', { name: 'Post supply', exact: true }).click()

    await expect(page.getByText(/rejected before it could become active/i)).toBeVisible()
    await expect(page.getByLabel('Quantity')).toBeEnabled()
    await page.getByLabel('Quantity').fill('6')
    await page.getByRole('button', { name: 'Post supply', exact: true }).click()
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()

    const owned = await page.evaluate(() => JSON.parse(localStorage.getItem('jettyshare:v1:owned-listings') || '{}')) as Record<string, unknown>
    expect(Object.keys(owned)).toHaveLength(1)
    expect(firstPayload).toBeTruthy()
    await context.close()
  })

  test('Quick Post can be completed with keyboard activation and has no preselected spoil time', async ({ browser }) => {
    const id = suffix()
    const berth = `K${id}`.slice(0, 12)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')
    await openPost(page, `QA Keyboard ${id}`)

    for (const label of ['15m', '30m', '1h', '2h', 'Custom']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'false')
    }

    const bait = page.getByRole('button', { name: 'BAIT', exact: true })
    await bait.focus()
    await page.keyboard.press('Space')
    await expect(bait).toHaveAttribute('aria-pressed', 'true')

    await page.getByLabel('Quantity').focus()
    await page.keyboard.type('1')
    await page.getByLabel('Pickup berth').focus()
    await page.keyboard.type(berth)
    const spoil = page.getByRole('button', { name: '30m', exact: true })
    await spoil.focus()
    await page.keyboard.press('Space')
    await expect(spoil).toHaveAttribute('aria-pressed', 'true')

    const submit = page.getByRole('button', { name: 'Post supply', exact: true })
    await submit.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
    await context.close()
  })
})
