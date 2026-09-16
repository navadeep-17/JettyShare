import { expect, test, type Page } from '@playwright/test'

function suffix() {
  return Date.now().toString().slice(-6)
}

function cssDurationMs(value: string) {
  return value.split(',').reduce((max, part) => {
    const token = part.trim()
    const parsed = parseFloat(token)
    const milliseconds = token.endsWith('ms') ? parsed : parsed * 1000
    return Math.max(max, Number.isFinite(milliseconds) ? milliseconds : 0)
  }, 0)
}

async function saveIdentityIfVisible(page: Page, label: string, action: 'Save & Post' | 'Save & Claim') {
  const heading = page.getByRole('heading', { name: 'What should crews call your boat?' })
  if (await heading.isVisible().catch(() => false)) {
    await page.getByLabel('Boat / crew name').fill(label)
    await page.getByRole('button', { name: action, exact: true }).click()
  }
}

async function createSupply(page: Page, label: string, berth: string) {
  await page.getByRole('button', { name: '+ Post', exact: true }).click()
  await saveIdentityIfVisible(page, label, 'Save & Post')
  await page.getByLabel('Quantity').fill('6')
  await page.getByLabel('Pickup berth').fill(berth)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await page.getByRole('button', { name: 'Post supply', exact: true }).click()
  await expect(page.locator('.supply-card', { hasText: `BERTH ${berth}` })).toBeVisible()
}

test.describe('Component 08 mobile design and accessibility gates', () => {
  test('wide desktop stays a centered single-column shell and dark-mode OS does not invert the app', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'JettyShare' })).toBeVisible()

    const layout = await page.locator('.app-shell').evaluate((shell) => {
      const rect = shell.getBoundingClientRect()
      const styles = getComputedStyle(document.documentElement)
      return {
        width: rect.width,
        left: rect.left,
        right: window.innerWidth - rect.right,
        colorScheme: styles.colorScheme,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      }
    })
    expect(layout.width).toBeLessThanOrEqual(720.5)
    expect(Math.abs(layout.left - layout.right)).toBeLessThanOrEqual(2)
    expect(layout.colorScheme).toContain('light')
    expect(layout.bodyBackground).toBe('rgb(248, 250, 252)')

    const columns = await page.locator('.supply-list').evaluate((list) => getComputedStyle(list).gridTemplateColumns).catch(() => '')
    if (columns) expect(columns.trim().split(/\s+/)).toHaveLength(1)
    await context.close()
  })

  test('dialog receives keyboard focus, traps it, closes on Escape and restores the trigger', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')

    const trigger = page.getByRole('button', { name: '+ Post', exact: true })
    await trigger.focus()
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const focusInside = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]')
      return Boolean(modal && document.activeElement && modal.contains(document.activeElement))
    })
    expect(focusInside).toBeTruthy()

    // Shift+Tab from the first focusable wraps to the final focusable.
    await page.keyboard.press('Shift+Tab')
    const stillInside = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]')
      return Boolean(modal && document.activeElement && modal.contains(document.activeElement))
    })
    expect(stillInside).toBeTruthy()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await context.close()
  })

  test('reduced-motion preference is honored and the core interface loads without webfonts or content images', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const fontRequests: string[] = []
    const imageRequests: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fontRequests.push(request.url())
      if (request.resourceType() === 'image') imageRequests.push(request.url())
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'JettyShare' })).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBeTruthy()
    expect(await page.locator('img').count()).toBe(0)
    expect(fontRequests).toEqual([])
    expect(imageRequests).toEqual([])

    const transition = await page.getByRole('button', { name: '+ Post', exact: true }).evaluate((element) => {
      const styles = getComputedStyle(element)
      return { transition: styles.transitionDuration, animation: styles.animationDuration }
    })
    // Browsers may serialize the near-zero reduced-motion duration as 1e-06s.
    expect(cssDurationMs(transition.transition)).toBeLessThanOrEqual(1)
    expect(cssDurationMs(transition.animation)).toBeLessThanOrEqual(1)
    await context.close()
  })

  test('claim receipt makes berth the dominant direction and labels hold and spoil deadlines separately', async ({ browser }) => {
    const id = suffix()
    const berth = `D${id}`.slice(0, 12)
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const claimantContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const provider = await providerContext.newPage()
    const claimant = await claimantContext.newPage()

    await provider.goto('/')
    await createSupply(provider, `QA Design Provider ${id}`, berth)
    await claimant.goto('/')

    const card = claimant.locator('.supply-card', { hasText: `BERTH ${berth}` })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /Claim/ }).click()
    await saveIdentityIfVisible(claimant, `QA Design Claimant ${id}`, 'Save & Claim')

    const receipt = claimant.getByRole('dialog', { name: 'Supply claimed' })
    await expect(receipt).toBeVisible()
    await expect(receipt.getByText('HOLD ENDS', { exact: true })).toBeVisible()
    await expect(receipt.getByText('SPOILS', { exact: true })).toBeVisible()

    const sizes = await receipt.evaluate((dialog) => {
      const berthText = dialog.querySelector<HTMLElement>('.berth-panel strong')
      const quantity = dialog.querySelector<HTMLElement>('.receipt-quantity')
      const deadlineLabel = dialog.querySelector<HTMLElement>('.receipt-grid span')
      return {
        berth: berthText ? parseFloat(getComputedStyle(berthText).fontSize) : 0,
        quantity: quantity ? parseFloat(getComputedStyle(quantity).fontSize) : 0,
        deadline: deadlineLabel ? parseFloat(getComputedStyle(deadlineLabel).fontSize) : 0,
        overflow: dialog.scrollWidth - dialog.clientWidth,
      }
    })
    expect(sizes.berth).toBeGreaterThan(sizes.quantity)
    expect(sizes.berth).toBeGreaterThan(sizes.deadline)
    expect(sizes.overflow).toBeLessThanOrEqual(1)

    await providerContext.close()
    await claimantContext.close()
  })
})
