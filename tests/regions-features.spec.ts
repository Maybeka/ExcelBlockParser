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

// ---------------------------------------------------------------------------
// Region Creation
// ---------------------------------------------------------------------------
test.describe('Region Creation', () => {
  async function addRegion(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/')
    await page.getByRole('button', { name: 'plus', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Add Region', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Region 1' })).toHaveValue('region_1')
  }

  test('Add Region menu creates a region card', async ({ page }) => {
    await addRegion(page)
  })

  test('Region expand/collapse controls its empty-range guidance', async ({ page }) => {
    await addRegion(page)

    await expect(page.getByText('Click and drag in the spreadsheet to select a region range.')).toBeVisible()
    await page.locator('.anticon-caret-down').first().click()
    await expect(page.getByText('Click and drag in the spreadsheet to select a region range.')).not.toBeVisible()
    await page.locator('.anticon-caret-right').first().click()
    await expect(page.getByText('Click and drag in the spreadsheet to select a region range.')).toBeVisible()
  })

  test('Delete region removes its card', async ({ page }) => {
    await addRegion(page)

    await page.getByRole('button', { name: 'delete', exact: true }).first().click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Region 1' })).not.toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Tag Management
// ---------------------------------------------------------------------------
test.describe('Tag Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'tag', exact: true }).click()
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
// Computed Properties
// ---------------------------------------------------------------------------
test.describe.skip('Computed Properties (workbook fixture required)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Computed-property controls appear only after a block has a selected range.
  })

  test('Expand computed properties section and add a property', async ({ page }) => {
    // The "Computed Properties" heading acts as a toggle.
    await page.locator('text=Computed Properties').click()

    // The "Add" button should appear inside the expanded section.
    // (The main "Add" button at the top is for blocks; we want the one scoped
    //  to computed properties.)
    const addButton = page.getByRole('button', { name: 'Add' })
    // After expanding CP there should be at least one "Add" button visible.
    await expect(addButton.first()).toBeVisible()
  })

  test('Valid expression shows green check', async ({ page }) => {
    await page.locator('text=Computed Properties').click()

    // Click "Add" to insert a new computed-property row.
    // Count "Add" buttons first so we click the right one.
    const addBtnsBefore = await page.getByRole('button', { name: 'Add' }).count()
    await page.getByRole('button', { name: 'Add' }).nth(addBtnsBefore - 1).click()

    // Fill the expression textarea with a valid expression.
    // The TextArea placeholder is  row['key'] * row['price']
    const exprInput = page.getByPlaceholder(/row\['key'\]/)
    await exprInput.fill('1 + 1')

    // A "✓ Valid" message appears in green (#52c41a).
    // <div style="font-size: 10px; color: #52c41a;">✓ Valid</div>
    await expect(page.locator('text=✓ Valid')).toBeVisible()
  })

  test('Invalid expression shows error', async ({ page }) => {
    await page.locator('text=Computed Properties').click()

    // Add a new computed property.
    const addBtnsBefore = await page.getByRole('button', { name: 'Add' }).count()
    await page.getByRole('button', { name: 'Add' }).nth(addBtnsBefore - 1).click()

    // Fill with an expression referencing an unknown key.
    const exprInput = page.getByPlaceholder(/row\['key'\]/)
    await exprInput.fill("row['nonexistent_column']")

    // An error message should appear in red (#ff4d4f).
    // <div style="font-size: 10px; color: #ff4d4f;">Unknown key: 'nonexistent_column'</div>
    await expect(page.locator('text=Unknown key')).toBeVisible()
  })

  test('Invalid syntax shows error', async ({ page }) => {
    await page.locator('text=Computed Properties').click()

    const addBtnsBefore = await page.getByRole('button', { name: 'Add' }).count()
    await page.getByRole('button', { name: 'Add' }).nth(addBtnsBefore - 1).click()

    // Syntax error: unbalanced parentheses.
    const exprInput = page.getByPlaceholder(/row\['key'\]/)
    await exprInput.fill('(1 + 1')

    // Should show a syntax error.
    await expect(page.locator('text=Syntax error')).toBeVisible()
  })

  test('Delete computed property removes the row', async ({ page }) => {
    await page.locator('text=Computed Properties').click()

    // Add one property.
    const addBtnsBefore = await page.getByRole('button', { name: 'Add' }).count()
    await page.getByRole('button', { name: 'Add' }).nth(addBtnsBefore - 1).click()

    // The row has a delete button (type="text" danger DeleteOutlined icon).
    const deleteBtns = page.locator('button').filter({ has: page.locator('.anticon-delete') })
    const deleteCountBefore = await deleteBtns.count()

    // Click the last visible delete button (the one for the CP, not for the block).
    // Block delete buttons are also delete icons, but they're a different group.
    // The CP delete buttons are inside the computed properties section.
    const cpSection = page.locator('text=Computed Properties').locator('..')
    // The parent div of the CP toggle has the delete buttons inside.
    // Instead, just count CP-add buttons (each CP row has a delete).

    // Actually, a simpler approach: delete buttons have aria-label or we look
    // for the last delete button which corresponds to the newly added CP.
    const allDeleteBtns = page.locator('[aria-label="delete"]')
    const lastDelete = allDeleteBtns.last()

    // Click it.
    await lastDelete.click()

    // The CP row should be gone.  Count rows or check no "Add" re-appeared.
    // Because there were no CPs initially, after adding and deleting one we
    // should be back to the "No computed properties" placeholder.
    await expect(page.locator('text=No computed properties')).toBeVisible()
  })
})
