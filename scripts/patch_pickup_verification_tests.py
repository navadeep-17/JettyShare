from pathlib import Path

# Update the real DEV lifecycle test to carry the claimant's pickup proof into
# the provider verification flow before collection.
core = Path('e2e/core-flow.spec.ts')
text = core.read_text()
old = """    await claimant.locator('.supply-card', { hasText: `BERTH ${berth}` }).getByRole('button', { name: /Claim/ }).click()\n    await expect(claimant.getByRole('dialog', { name: 'Supply claimed' })).toBeVisible()\n    await claimant.getByRole('button', { name: 'Done — back to board', exact: true }).click()\n\n    await provider.getByRole('button', { name: 'Activity', exact: true }).click()\n    const managedPost = provider.locator('.managed-card', { hasText: `BERTH ${berth}` })\n    await expect(managedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible()\n    provider.once('dialog', (dialog) => dialog.accept())\n    await managedPost.getByRole('button', { name: 'Confirm collected', exact: true }).click()\n"""
new = """    await claimant.locator('.supply-card', { hasText: `BERTH ${berth}` }).getByRole('button', { name: /Claim/ }).click()\n    const secondReceipt = claimant.getByRole('dialog', { name: 'Supply claimed' })\n    await expect(secondReceipt).toBeVisible()\n    const pickupCode = (await secondReceipt.locator('[aria-label=\"Pickup verification code\"] .quantity').textContent())?.trim() ?? ''\n    expect(pickupCode).toMatch(/^\\d{4}$/)\n    await secondReceipt.getByRole('button', { name: 'Done — back to board', exact: true }).click()\n\n    await provider.getByRole('button', { name: 'Activity', exact: true }).click()\n    const managedPost = provider.locator('.managed-card', { hasText: `BERTH ${berth}` })\n    await expect(managedPost.getByText(`Claimed by ${claimantLabel}`)).toBeVisible()\n    const confirm = managedPost.getByRole('button', { name: 'Confirm collected', exact: true })\n    await expect(confirm).toBeDisabled()\n    await managedPost.getByLabel(`Pickup code for berth ${berth}`).fill(pickupCode)\n    await managedPost.getByRole('button', { name: 'Verify pickup code', exact: true }).click()\n    await expect(managedPost.getByText(/Collector verified — safe to hand over/i)).toBeVisible()\n    await expect(confirm).toBeEnabled()\n    provider.once('dialog', (dialog) => dialog.accept())\n    await confirm.click()\n"""
if old not in text:
    raise SystemExit('core-flow pickup anchor not found')
core.write_text(text.replace(old, new))

life = Path('e2e/lifecycle.spec.ts')
text = life.read_text()
# Claim-authorized receipts now include the proof used at pickup.
text = text.replace(
    "    server_now: new Date(now).toISOString(),\n    ...overrides,\n  }\n}\n\nfunction managedPost",
    "    server_now: new Date(now).toISOString(),\n    pickup_code: '2468',\n    ...overrides,\n  }\n}\n\nfunction managedPost",
)

old = """    await page.route('**/rest/v1/rpc/confirm_collected', async (route) => {\n      confirmCalls += 1\n      collected = true\n      await route.abort('failed')\n    })\n\n    await page.goto('/')\n    await page.getByRole('button', { name: 'Activity', exact: true }).click()\n    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })\n    await expect(card).toBeVisible()\n    page.once('dialog', (dialog) => dialog.accept())\n    await card.getByRole('button', { name: 'Confirm collected', exact: true }).click()\n"""
new = """    await page.route('**/rest/v1/rpc/verify_pickup_code', async (route) => {\n      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true, claimant_label: 'QA Lifecycle Claimant', claim_version: CLAIM_VERSION, server_now: new Date().toISOString() }) })\n    })\n    await page.route('**/rest/v1/rpc/confirm_collected', async (route) => {\n      confirmCalls += 1\n      const body = route.request().postDataJSON() as Record<string, unknown>\n      expect(body.p_pickup_code).toBe('2468')\n      collected = true\n      await route.abort('failed')\n    })\n\n    await page.goto('/')\n    await page.getByRole('button', { name: 'Activity', exact: true }).click()\n    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })\n    await expect(card).toBeVisible()\n    const confirm = card.getByRole('button', { name: 'Confirm collected', exact: true })\n    await expect(confirm).toBeDisabled()\n    await card.getByLabel('Pickup code for berth LIFE-1').fill('2468')\n    await card.getByRole('button', { name: 'Verify pickup code', exact: true }).click()\n    await expect(confirm).toBeEnabled()\n    page.once('dialog', (dialog) => dialog.accept())\n    await confirm.click()\n"""
if old not in text:
    raise SystemExit('lifecycle lost-collection anchor not found')
text = text.replace(old, new)

old = """    const confirm = card.getByRole('button', { name: 'Confirm collected', exact: true })\n    const release = card.getByRole('button', { name: 'Release claim', exact: true })\n    await expect(confirm).toBeEnabled()\n    await expect(release).toBeEnabled()\n    const sizes = await Promise.all([confirm, release].map((button) => button.boundingBox()))\n    for (const box of sizes) expect(box && box.height >= 44).toBeTruthy()\n"""
new = """    const confirm = card.getByRole('button', { name: 'Confirm collected', exact: true })\n    const verify = card.getByRole('button', { name: 'Verify pickup code', exact: true })\n    const release = card.getByRole('button', { name: 'Release claim', exact: true })\n    await expect(confirm).toBeDisabled()\n    await expect(verify).toBeDisabled()\n    await expect(release).toBeEnabled()\n    await card.getByLabel('Pickup code for berth LIFE-1').fill('2468')\n    await expect(verify).toBeEnabled()\n    await page.route('**/rest/v1/rpc/verify_pickup_code', async (route) => {\n      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true, claimant_label: 'QA Lifecycle Claimant', claim_version: CLAIM_VERSION, server_now: new Date().toISOString() }) })\n    })\n    await verify.click()\n    await expect(confirm).toBeEnabled()\n    const sizes = await Promise.all([confirm, verify, release].map((button) => button.boundingBox()))\n    for (const box of sizes) expect(box && box.height >= 44).toBeTruthy()\n"""
if old not in text:
    raise SystemExit('lifecycle mobile-controls anchor not found')
text = text.replace(old, new)

old = """    await page.goto('/')\n    await page.getByRole('button', { name: 'Activity', exact: true }).click()\n    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })\n    await expect(card.getByRole('button', { name: 'Confirm collected', exact: true })).toBeEnabled()\n\n    const readsBeforeFocus = reads\n"""
new = """    await page.goto('/')\n    await page.getByRole('button', { name: 'Activity', exact: true }).click()\n    const card = page.locator('.managed-card', { hasText: 'BERTH LIFE-1' })\n    await expect(card.getByRole('button', { name: 'Confirm collected', exact: true })).toBeDisabled()\n    await expect(card.getByRole('button', { name: 'Release claim', exact: true })).toBeEnabled()\n    await expect(card.getByLabel('Pickup code for berth LIFE-1')).toBeEnabled()\n\n    const readsBeforeFocus = reads\n"""
if old not in text:
    raise SystemExit('lifecycle focus anchor not found')
text = text.replace(old, new)
life.write_text(text)

print('pickup verification test expectations updated')
