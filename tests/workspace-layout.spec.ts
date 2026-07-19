import { expect, test } from '@playwright/test'

test.describe('M3 workspace layout', () => {
  test('shows durable workspace navigation and diagnostics', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()

    const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
    await expect(navigator.getByText('Sheets', { exact: true })).toBeVisible()
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Extractors' })).toBeVisible()
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Regions' })).toBeVisible()
    await expect(navigator.getByText('block_1')).toBeVisible()

    await page.getByRole('button', { name: 'Diagnostics' }).click()
    await expect(page.getByText('No validation issues')).toBeVisible()
  })

  test('keeps block ordering consistent between navigator and inspector', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()

    const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
    await navigator.getByText('block_3').hover()
    await navigator.getByRole('button', { name: 'Move up' }).last().click()

    const labels = page.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value).filter(value => value.startsWith('block_')))
    await expect(labels).resolves.toEqual(['block_1', 'block_3', 'block_2'])
  })

  test('uses a drawer navigator at compact widths', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Workspace navigation', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('navigation', { name: 'Workspace navigator' })).toBeVisible()
  })

  test('allows desktop navigation to be hidden and restored', async ({ page }) => {
    await page.goto('/')

    const navigation = page.getByRole('navigation', { name: 'Workspace navigator' })
    await expect(navigation).not.toBeVisible()
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(navigation).toBeVisible()
    await page.getByRole('button', { name: 'Hide workspace navigation' }).click()
    await expect(navigation).not.toBeVisible()
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(navigation).toBeVisible()
  })

  test('exposes keyboard commands for common workspace actions', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Open Excel' })).toHaveAttribute('aria-keyshortcuts', /Control\+O/)
    await expect(page.getByRole('button', { name: 'Parse & Preview' })).toHaveAttribute('aria-keyshortcuts', /Control\+Enter/)
    await expect(page.getByRole('button', { name: 'Export' })).toHaveAttribute('aria-keyshortcuts', /Control\+S/)
  })
})
