import { expect, test } from '@playwright/test'

test.describe('M3 workspace layout', () => {
  test('shows durable workspace navigation and diagnostics', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()

    const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })
    await expect(navigator.locator('.workspace-project-avatar .anticon-folder')).toBeVisible()
    await expect(navigator.locator('.workspace-project-avatar .anticon-file-excel')).toHaveCount(0)
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Workbooks' })).toBeVisible()
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

  test('keeps the active configuration section reachable at compact widths', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')

    const inspector = page.getByRole('complementary', { name: 'Workspace configuration' })
    await expect(inspector.locator('[data-feature-id="builtin.extraction"]')).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Add Block' })).toBeVisible()
    await inspector.getByRole('button', { name: 'Add Region' }).click()
    await expect(inspector.locator('[data-feature-id="builtin.regions"]')).toBeVisible()
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

  test('allows desktop navigation width to be adjusted from its separator', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()

    const separator = page.getByRole('separator', { name: 'Resize workspace navigation' })
    await expect(separator).toHaveAttribute('aria-valuenow', '272')
    await separator.focus()
    await separator.press('ArrowLeft')
    await expect(separator).toHaveAttribute('aria-valuenow', '260')
    await separator.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '272')
  })

  test('collapses workbook, extractor, and region sections independently', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    const navigator = page.getByRole('navigation', { name: 'Workspace navigator' })

    const workbooks = navigator.getByRole('button', { name: 'Workbooks' })
    const extractors = navigator.getByRole('button', { name: 'Extractors' })
    const regions = navigator.getByRole('button', { name: 'Regions' })
    await expect(navigator.getByRole('button', { name: 'Add Region' })).toHaveCount(0)
    await expect(workbooks).toHaveAttribute('aria-expanded', 'true')
    await expect(extractors).toHaveAttribute('aria-expanded', 'true')
    await expect(regions).toHaveAttribute('aria-expanded', 'true')

    await extractors.click()
    await expect(extractors).toHaveAttribute('aria-expanded', 'false')
    await expect(navigator.getByText('block_1', { exact: true })).toBeHidden()
    await regions.click()
    await expect(regions).toHaveAttribute('aria-expanded', 'false')
    await expect(navigator.getByText('No regions configured.', { exact: true })).toBeHidden()
    await workbooks.click()
    await expect(workbooks).toHaveAttribute('aria-expanded', 'false')
    await expect(navigator.getByText('Open workbooks whenever you need them.', { exact: true })).toBeHidden()
  })

  test('exposes keyboard commands for common workspace actions', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Open Project' })).toHaveAttribute('aria-keyshortcuts', /Control\+O/)
    await expect(page.getByRole('button', { name: 'Run & Preview' })).toHaveAttribute('aria-keyshortcuts', /Control\+Enter/)
  })
})
