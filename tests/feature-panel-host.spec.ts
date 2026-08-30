import { expect, test } from '@playwright/test'

test.describe('Gate B feature panel host', () => {
  test('mounts only the active Block view through the host-owned section', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Workspace configuration' })
    const blocks = panel.locator('[data-feature-id="builtin.extraction"]')
    await expect(blocks.getByText('Blocks', { exact: true })).toBeVisible()
    await expect(panel.locator('[data-feature-id="builtin.regions"]')).toHaveCount(0)
    const content = blocks.getByLabel('Blocks content')
    await expect(content).toHaveAttribute('tabindex', '0')
    await content.focus()
    await expect(content).toBeFocused()
    await content.press('Tab')
    await expect(content).not.toBeFocused()
    await expect(blocks.getByRole('button', { name: 'Add Block' })).toBeVisible()
    await expect(blocks.locator('.extractor-card')).toHaveCount(1)
    await expect(blocks.locator('.extractor-card')).not.toHaveClass(/is-active/)
  })

  test('shows only the newly active Block after another Block is added', async ({ page }) => {
    await page.goto('/')
    const panel = page.getByRole('complementary', { name: 'Workspace configuration' })
    await panel.getByRole('button', { name: 'Add Block' }).click()

    await expect(panel.locator('.extractor-card')).toHaveCount(1)
    await expect(panel.getByRole('textbox', { name: 'Block 1' })).toHaveValue('block_2')
    await expect(panel.getByRole('textbox', { name: 'Block 1' })).not.toHaveValue('block_1')
  })

  test('replaces the Block editor with the active Region editor', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Region' }).click()

    const panel = page.getByRole('complementary', { name: 'Workspace configuration' })
    await expect(panel.locator('[data-feature-id="builtin.extraction"]')).toHaveCount(0)
    await expect(panel.locator('[data-feature-id="builtin.regions"]')).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Region 1' })).toHaveValue('region_1')
    await expect(panel.getByRole('button', { name: 'Add Block' })).toBeVisible()
    await expect(panel.locator('.telegram-card')).not.toHaveClass(/is-active/)
    await panel.getByRole('button', { name: 'Add Region' }).click()
    await expect(panel.locator('.telegram-card')).toHaveCount(1)
    await expect(panel.getByRole('textbox', { name: 'Region 1' })).toHaveValue('region_2')
  })

  test('keeps the primary add action at the end of the Blocks header toolbar', async ({ page }) => {
    await page.goto('/')
    const blocks = page.locator('[data-feature-id="builtin.extraction"]')
    const actions = blocks.locator('.panel-heading-actions')
    const addBlock = actions.getByRole('button', { name: 'Add Block' })

    await expect(actions.getByRole('button', { name: 'Add Region' })).toBeVisible()

    const [addBounds, addRegionBounds] = await Promise.all([
      addBlock.boundingBox(),
      actions.getByRole('button', { name: 'Add Region' }).boundingBox(),
    ])
    expect(addBounds).not.toBeNull()
    expect(addRegionBounds).not.toBeNull()
    expect(addBounds!.x).toBeGreaterThan(addRegionBounds!.x)
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
    await expect(page.getByRole('complementary', { name: 'Workspace configuration' })).toBeVisible()
    expect(scopedClass).toMatch(/^_panel_/)
    await expect(page.locator(`body.${scopedClass}`)).toHaveCount(0)
  })
})
