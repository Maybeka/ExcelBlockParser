/**
 * Smoke tests for regions + features (tags, computed properties).
 *
 * Region controls are integrated through ConfigPanel after a region is added.
 *
 * Tag management and computed-property validation ARE wired in
 * ConfigPanel.tsx and have real tests below.
 *
 * Run: npx playwright test tests/regions-features.spec.ts
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

async function loadWorkbookFixture(page: import('@playwright/test').Page): Promise<void> {
  const [workbook, project] = await Promise.all([
    readFile(resolve(root, 'examples', 'test_data.xlsx')),
    readFile(resolve(root, 'examples', 'project.json'), 'utf8'),
  ])
  await page.addInitScript(({ workbookBase64, sessionContent }) => {
    const workbookBytes = () => {
      const binary = atob(workbookBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      return bytes.buffer
    }
    ;(window as any).electronAPI = {
      openXlsx: async () => ({ status: 'ok', value: '/fixtures/test_data.xlsx' }),
      readFile: async () => ({ status: 'ok', value: workbookBytes() }),
      saveJson: async () => ({ status: 'ok', value: { filePath: '/fixtures/project.json' } }),
      saveJsonToPath: async (filePath: string) => ({ status: 'ok', value: { filePath } }),
      openJson: async () => ({ status: 'ok', value: { filePath: '/fixtures/project.json', content: sessionContent } }),
      saveRecovery: async () => ({ status: 'ok', value: undefined }),
      loadRecovery: async () => ({ status: 'ok', value: null }),
      clearRecovery: async () => ({ status: 'ok', value: undefined }),
      log: () => undefined,
      openPreviewWindow: async () => undefined,
      setPreviewData: async () => undefined,
      getPreviewData: async () => undefined,
      closePreviewWindow: async () => undefined,
      onPreviewReload: () => () => undefined,
    }
  }, { workbookBase64: workbook.toString('base64'), sessionContent: project })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Project' }).click()
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: 'Reassign' }).click()
  await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
  await settings.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('textbox', { name: 'block_1' })).toBeVisible()
  await page.waitForTimeout(500)
  const closePreview = page.getByRole('button', { name: 'Close preview' })
  if (await closePreview.isVisible().catch(() => false)) await closePreview.click()
}

// ---------------------------------------------------------------------------
// Region Creation
// ---------------------------------------------------------------------------
test.describe('Region Creation', () => {
  async function addRegion(page: import('@playwright/test').Page): Promise<void> {
    await loadWorkbookFixture(page)
    await page.getByRole('button', { name: 'Add Region', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Region 1' })).toHaveValue('region_1')
  }

  test('Add Region menu creates a region card', async ({ page }) => {
    await addRegion(page)
  })

  test('Region editor keeps its empty-range guidance visible', async ({ page }) => {
    await addRegion(page)

    await expect(page.getByText('Click and drag in the spreadsheet to select a region range.')).toBeVisible()
  })

  test('Delete region removes its card', async ({ page }) => {
    await addRegion(page)

    const regionCard = page.getByRole('textbox', { name: 'Region 1' }).locator('xpath=../..')
    const deleteButton = regionCard.getByRole('button', { name: 'delete', exact: true })
    await expect(deleteButton).toHaveCount(1)
    await deleteButton.click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Region 1' })).not.toBeVisible()
  })
})

test.describe('Row filtering', () => {
  test('configures empty-row handling and nested membership conditions', async ({ page }) => {
    await loadWorkbookFixture(page)
    await page.getByText('Row Filter', { exact: true }).click()

    const removeEmptyRows = page.getByRole('checkbox', { name: 'Remove empty rows' })
    const struckEmpty = page.getByRole('checkbox', { name: 'Treat fully struck-through cells as empty' })
    await expect(removeEmptyRows).toBeChecked()
    await expect(struckEmpty).toBeChecked()

    await removeEmptyRows.uncheck()
    await expect(struckEmpty).toBeDisabled()
    await removeEmptyRows.check()
    await expect(struckEmpty).toBeEnabled()
    await expect(struckEmpty).toBeChecked()

    await page.getByRole('button', { name: /Add condition/ }).click()
    await expect(page.getByText('All', { exact: true })).toBeVisible()
    await page.locator('.row-filter-operator').click()
    await page.getByText('not in', { exact: true }).last().click()
    await expect(page.locator('.row-filter-value')).toBeVisible()
    await page.getByRole('button', { name: 'Add group' }).click()
    await expect(page.getByRole('button', { name: 'Delete row condition group' })).toHaveCount(1)
  })

  test('preserves condition values and requires confirmation before clearing', async ({ page }) => {
    await loadWorkbookFixture(page)
    await page.getByText('Row Filter', { exact: true }).click()

    const editor = page.locator('.row-filter-editor')
    const removeEmptyRows = page.getByRole('checkbox', { name: 'Remove empty rows' })
    const struckEmpty = page.getByRole('checkbox', { name: 'Treat fully struck-through cells as empty' })
    await editor.getByText('Remove empty rows', { exact: true }).click()
    await expect(removeEmptyRows).toBeChecked()
    await editor.getByText('Treat fully struck-through cells as empty', { exact: true }).click()
    await expect(struckEmpty).toBeChecked()
    await removeEmptyRows.uncheck()
    await expect(removeEmptyRows).not.toBeChecked()

    await page.getByRole('button', { name: /Add condition/ }).click()
    const input = editor.locator('input.row-filter-value')
    await input.fill('archived')
    await editor.locator('.row-filter-operator').click()
    await page.locator('.ant-select-dropdown:visible').getByText('contains', { exact: true }).click()
    await expect(input).toHaveValue('archived')

    await editor.locator('.row-filter-operator').click()
    await page.locator('.ant-select-dropdown:visible').getByText('not in', { exact: true }).click()
    await expect(editor.locator('.row-filter-value .ant-select-selection-item')).toHaveText('archived')

    await editor.getByRole('button', { name: 'Clear conditions' }).click()
    await expect(page.getByText('Clear all row filter conditions?')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Clear conditions' })).toBeVisible()

    await editor.getByRole('button', { name: 'Clear conditions' }).click()
    await page.getByRole('button', { name: 'Clear conditions', exact: true }).last().click()
    await expect(editor.getByRole('button', { name: /Add condition/ })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Tag Management
// ---------------------------------------------------------------------------
test.describe('Tag Management', () => {
  test.beforeEach(async ({ page }) => {
    await loadWorkbookFixture(page)
    await page.getByRole('button', { name: 'Show block info' }).click()
    await expect(page.locator('button').filter({ hasText: 'Tag' })).toBeVisible()
  })

  test('Add label tag to block', async ({ page }) => {
    // Click the "+ Tag" button inside the block row.
    // <Button size="small" type="dashed" icon={<PlusOutlined />}>Tag</Button>
    await page.locator('button').filter({ hasText: 'Tag' }).click()

    const keyInput = page.getByPlaceholder('tag or key:value')

    await keyInput.fill('my-label')

    // Click ✓ to confirm.
    // The confirm button is an antd <Button type="link"> with text "✓".
    await page.getByRole('button', { name: '✓' }).click()

    // The tag chip (<Tag>) should now be visible.
    // Tag content is the key for label-type tags.
    await expect(page.locator('.ant-tag:has-text("my-label")')).toBeVisible()
  })

  test('Remove tag from block', async ({ page }) => {
    // First add a tag so there is something to remove.
    await page.locator('button').filter({ hasText: 'Tag' }).click()
    await page.getByPlaceholder('tag or key:value').fill('remove-me')
    await page.getByRole('button', { name: '✓' }).click()
    await expect(page.locator('.ant-tag:has-text("remove-me")')).toBeVisible()

    // Click the close icon on the tag chip.
    // antd Tag renders a <span class="ant-tag-close-icon"> with role="button".
    const closeIcon = page.locator('.ant-tag:has-text("remove-me") .ant-tag-close-icon')
    await closeIcon.click()

    // The tag chip should disappear.
    await expect(page.locator('.ant-tag:has-text("remove-me")')).not.toBeVisible()
  })

  test('Tag editor is still accessible after adding a tag', async ({ page }) => {
    // Add one tag.
    await page.locator('button').filter({ hasText: 'Tag' }).click()
    await page.getByPlaceholder('tag or key:value').fill('tag-one')
    await page.getByRole('button', { name: '✓' }).click()
    await expect(page.locator('.ant-tag:has-text("tag-one")')).toBeVisible()

    // The "Tag" button should still be present to allow adding more tags.
    await expect(page.locator('button').filter({ hasText: 'Tag' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Downstream Properties
// ---------------------------------------------------------------------------
test.describe('Downstream Properties', () => {
  test.beforeEach(async ({ page }) => {
    await loadWorkbookFixture(page)
  })

  const addProperty = (page: import('@playwright/test').Page) => page
    .getByText('Downstream Properties', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'plus Add' })

  test('Expand computed properties section and add a property', async ({ page }) => {
    // The downstream metadata heading acts as a toggle.
    await page.locator('text=Downstream Properties').click()

    // The "Add" button should appear inside the expanded section.
    // (The main "Add" button at the top is for blocks; we want the one scoped
    //  to computed properties.)
    const addButton = addProperty(page)
    // After expanding CP there should be at least one "Add" button visible.
    await expect(addButton.first()).toBeVisible()
  })

  test('Valid expression shows green check', async ({ page }) => {
    await page.locator('text=Downstream Properties').click()

    // Click "Add" to insert a new computed-property row.
    // Count "Add" buttons first so we click the right one.
    await addProperty(page).click()

    const exprInput = page.getByPlaceholder('field_a * field_b')
    await exprInput.fill('1 + 1')

    // A "✓ Valid" message appears in green (#52c41a).
    // <div style="font-size: 10px; color: #52c41a;">✓ Valid</div>
    await expect(page.locator('text=✓ Valid')).toBeVisible()
  })

  test('Invalid expression shows error', async ({ page }) => {
    await page.locator('text=Downstream Properties').click()

    // Add a new computed property.
    await addProperty(page).click()

    // Fill with an expression referencing an unknown key.
    const exprInput = page.getByPlaceholder('field_a * field_b')
    await exprInput.fill("row['nonexistent_column']")

    // An error message should appear in red (#ff4d4f).
    // <div style="font-size: 10px; color: #ff4d4f;">Unknown key: 'nonexistent_column'</div>
    await expect(page.locator('text=Unknown key')).toBeVisible()
  })

  test('Invalid syntax shows error', async ({ page }) => {
    await page.locator('text=Downstream Properties').click()

    await addProperty(page).click()

    // Syntax error: unbalanced parentheses.
    const exprInput = page.getByPlaceholder('field_a * field_b')
    await exprInput.fill('(1 + 1')

    // Should show a syntax error.
    await expect(page.locator('text=Syntax error')).toBeVisible()
  })

  test('Delete computed property removes the row', async ({ page }) => {
    await page.locator('text=Downstream Properties').click()

    // Add one property.
    await addProperty(page).click()

    const propertyRow = page.getByPlaceholder('field_a * field_b').locator('xpath=../..')
    await propertyRow.getByRole('button').click()

    // The CP row should be gone.  Count rows or check no "Add" re-appeared.
    // Because there were no CPs initially, after adding and deleting one we
    // should be back to the "No computed properties" placeholder.
    await expect(page.locator('text=No computed properties')).toBeVisible()
  })
})

test.describe('Block range reset', () => {
  test('shows the existing source, requires review, and supports cancellation', async ({ page }) => {
    await loadWorkbookFixture(page)

    await page.getByLabel('Reset range').click()
    await expect(page.getByText('Current source')).toBeVisible()
    await expect(page.getByText('test_data.xlsx · Sheet1 · A1:D9')).toBeVisible()
    await page.getByRole('button', { name: 'Review change' }).click()
    await expect(page.getByText('Review range change')).toBeVisible()
    await expect(page.getByText('Compatible column, filter, tag, and property configuration is retained.')).toBeVisible()
    await page.locator('.block-range-reset-flow').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByText('Current source')).toHaveCount(0)
  })
})
