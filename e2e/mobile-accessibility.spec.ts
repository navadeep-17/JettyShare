import { expect, test } from '@playwright/test'

for (const width of [320, 360]) {
  test(`${width}px board has no horizontal overflow and core targets remain tappable`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 740 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'JettyShare' })).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    const undersized = await page.locator('button:visible').evaluateAll((buttons) => buttons
      .map((button) => {
        const rect = button.getBoundingClientRect()
        return { text: (button.textContent || button.getAttribute('aria-label') || '').trim(), width: rect.width, height: rect.height }
      })
      .filter(({ width: w, height: h }) => w < 44 || h < 44))
    expect(undersized).toEqual([])

    await context.close()
  })
}

test('preview diagnostics identifies DEV database without exposing key contents', async ({ page }) => {
  await page.goto('/diagnostics')
  await expect(page.getByRole('heading', { name: 'JettyShare environment' })).toBeVisible()
  await expect(page.getByText('preview', { exact: true })).toBeVisible()
  await expect(page.getByText('ysexholoqrxyuqhmrkuq.supabase.co', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('sb_publishable_')
})

test('unavailable browser storage blocks identity mutation truthfully', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError') }
  })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await page.getByLabel('Boat / crew name').fill('No Storage Boat')
  await page.getByRole('button', { name: 'Save & Post' }).click()
  await expect(page.getByRole('alert')).toContainText('Site storage is unavailable')
  await expect(page.getByRole('heading', { name: 'What should crews call your boat?' })).toBeVisible()
  await context.close()
})
