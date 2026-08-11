import { expect, test } from '@playwright/test'

test.describe('Gate B feature panel host', () => {
  test('mounts the extraction view through the host-owned boundary', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Extraction inspector' })
    await expect(panel).toHaveAttribute('data-feature-id', 'builtin.extraction')
    await expect(panel.getByText('Extraction setup')).toBeVisible()
    const content = panel.getByLabel('Extraction setup content')
    await expect(content).toHaveAttribute('tabindex', '0')
    await content.focus()
    await expect(content).toBeFocused()
    await content.press('Tab')
    await expect(content).not.toBeFocused()
    await expect(panel.getByRole('button', { name: 'Add Block' })).toBeVisible()
  })

  test('mounts a materially different review view through the same host', async ({ page }) => {
    await page.goto('/?feature-panel-prototype=external-review')
    const panel = page.getByRole('complementary', { name: 'External result review inspector' })
    await expect(panel).toHaveAttribute('data-feature-id', 'builtin.external-review')
    await expect(panel.getByTestId('external-review-panel')).toBeVisible()
    await expect(panel.getByText('Review queue')).toBeVisible()
    await expect(panel.getByText('candidate-result.json')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Add Block' })).toHaveCount(0)
  })

  test('isolates render failure without breaking the shell or canvas', async ({ page }) => {
    await page.goto('/?feature-panel-prototype=render-failure')
    const panel = page.getByRole('complementary', { name: 'Feature failure fixture' })
    await expect(panel.getByTestId('feature-panel-error')).toContainText('Gate B render-isolation fixture')
    await expect(page.getByRole('region', { name: 'Workbook canvas' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Project' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show workspace navigation' })).toBeEnabled()
    await page.evaluate(() => {
      history.pushState({}, '', '/?feature-panel-prototype=external-review')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByTestId('external-review-panel')).toBeVisible()
    await expect(page.getByTestId('feature-panel-error')).toHaveCount(0)
  })

  test('unmounts the prior view and its scoped styles when another view is loaded', async ({ page }) => {
    await page.goto('/?feature-panel-prototype=external-review')
    await expect(page.getByTestId('external-review-panel')).toBeVisible()
    const scopedClass = await page.getByTestId('external-review-panel').getAttribute('class')

    await page.evaluate(() => {
      history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByTestId('external-review-panel')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Extraction inspector' })).toBeVisible()
    expect(scopedClass).toMatch(/^_panel_/)
    await expect(page.locator(`body.${scopedClass}`)).toHaveCount(0)
  })
})
