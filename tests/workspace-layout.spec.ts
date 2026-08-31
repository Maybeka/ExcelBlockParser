import { expect, test } from '@playwright/test'

test.describe('M3 workspace layout', () => {
  test('shows durable workspace navigation and diagnostics', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()

    const navigator = page.getByRole('navigation', { name: 'Workspace navigation' })
    await expect(navigator.locator('.workspace-project-avatar .anticon-folder')).toBeVisible()
    await expect(navigator.locator('.workspace-project-avatar .anticon-file-excel')).toHaveCount(0)
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Workbooks' })).toBeVisible()
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Blocks' })).toBeVisible()
    await expect(navigator.locator('.workspace-section-title').filter({ hasText: 'Regions' })).toBeVisible()
    await expect(navigator.getByText('No blocks configured.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Diagnostics' })).toHaveCount(0)
  })

  test('keeps block creation unavailable until a workbook is active', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Add Region', exact: true })).toBeDisabled()
  })

  test('uses a drawer navigator at compact widths', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Workspace navigation', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible()
  })

  test('keeps the active configuration section reachable at compact widths', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')

    const inspector = page.getByRole('complementary', { name: 'Extractions' })
    await expect(inspector.locator('[data-feature-id="builtin.extraction"]')).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Add Block', exact: true })).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
    await expect(inspector.getByRole('button', { name: 'Add Region', exact: true })).toBeDisabled()
  })

  test('allows desktop navigation to be hidden and restored', async ({ page }) => {
    await page.goto('/')

    const navigation = page.getByRole('navigation', { name: 'Workspace navigation' })
    await expect(navigation).not.toBeVisible()
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(navigation).toBeVisible()
    await page.getByRole('button', { name: 'Hide workspace navigation' }).click()
    await expect(navigation).not.toBeVisible()
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(navigation).toBeVisible()
  })

  test('collapses Extractions without unmounting the workbook canvas', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('excel-block-parser.inspector-hidden'))
    await page.goto('/?e2e=1')

    const inspector = page.getByRole('complementary', { name: 'Extractions' })
    await expect(inspector).toBeVisible()
    await page.getByRole('button', { name: 'Hide Extractions' }).click()
    await expect(inspector).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Show Extractions' })).toBeVisible()
    await page.getByRole('button', { name: 'Show Extractions' }).click()
    await expect(inspector).toBeVisible()
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

  test('collapses workbook, block, and region sections independently', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    const navigator = page.getByRole('navigation', { name: 'Workspace navigation' })

    const workbooks = navigator.getByRole('button', { name: 'Workbooks' })
    const blocks = navigator.getByRole('button', { name: 'Blocks' })
    const regions = navigator.getByRole('button', { name: 'Regions' })
    await expect(navigator.getByRole('button', { name: 'Add Region' })).toHaveCount(0)
    await expect(workbooks).toHaveAttribute('aria-expanded', 'true')
    await expect(blocks).toHaveAttribute('aria-expanded', 'true')
    await expect(regions).toHaveAttribute('aria-expanded', 'true')

    await blocks.click()
    await expect(blocks).toHaveAttribute('aria-expanded', 'false')
    await expect(navigator.getByText('No blocks configured.', { exact: true })).toBeHidden()
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
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-keyshortcuts', /Control\+Enter/)
  })
})
