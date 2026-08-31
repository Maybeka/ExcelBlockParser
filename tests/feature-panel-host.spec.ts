import { expect, test } from '@playwright/test'

test.describe('Gate B feature panel host', () => {
  test('mounts only the active Block view through the host-owned section', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Extractions' })
    const blocks = panel
    await expect(blocks.getByRole('button', { name: 'Add Block', exact: true })).toBeVisible()
    await expect(panel.locator('[data-feature-id="builtin.regions"]')).toHaveCount(0)
    const content = blocks.getByLabel('Extractions content')
    await expect(content).toHaveAttribute('tabindex', '0')
    await content.focus()
    await expect(content).toBeFocused()
    await content.press('Tab')
    await expect(content).not.toBeFocused()
    await expect(blocks.locator('.extractor-card')).toHaveCount(0)
    await expect(blocks.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
  })

  test('does not create a Block before a workbook is active', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Extractions' })
    await expect(panel.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
    await expect(panel.locator('.extractor-card')).toHaveCount(0)
  })

  test('does not create a Region before a workbook is active', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Extractions' })
    await expect(panel.getByRole('button', { name: 'Add Region', exact: true })).toBeDisabled()
    await expect(panel.locator('[data-feature-id="builtin.regions"]')).toHaveCount(0)
  })

  test('keeps the Block and Region actions together in the header toolbar', async ({ page }) => {
    await page.goto('/')
    const blocks = page.getByRole('complementary', { name: 'Extractions' })
    const actions = blocks
    const addBlock = actions.getByRole('button', { name: 'Add Block', exact: true })

    await expect(actions.getByRole('button', { name: 'Add Region', exact: true })).toBeVisible()

    const [addBounds, addRegionBounds] = await Promise.all([
      addBlock.boundingBox(),
      actions.getByRole('button', { name: 'Add Region', exact: true }).boundingBox(),
    ])
    expect(addBounds).not.toBeNull()
    expect(addRegionBounds).not.toBeNull()
    expect(addRegionBounds!.x).toBeGreaterThan(addBounds!.x)
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
    await expect(page.getByRole('complementary', { name: 'Extractions' })).toBeVisible()
    expect(scopedClass).toMatch(/^_panel_/)
    await expect(page.locator(`body.${scopedClass}`)).toHaveCount(0)
  })
})
