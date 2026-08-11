import { expect, test } from '@playwright/test'

test.describe('M4 recovery controls', () => {
  test('undo and redo restore workspace mutations', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('textbox', { name: 'block_2' })).toBeVisible()

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Meta+Z')
    await expect(page.getByRole('textbox', { name: 'block_2' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled()

    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(page.getByRole('textbox', { name: 'block_2' })).toBeVisible()
  })

  test('offers an explicit choice when a recovery project exists', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('excel-block-parser.recovery', JSON.stringify({
        version: 3,
        exportedAt: '2026-07-15T00:00:00.000Z',
        project: { id: 'recovered-project', name: 'Recovered', workbooks: [], activeWorkbookId: null, blocks: [], regions: [], activeBlockId: '', activeRegionId: null, focusMode: 'always-editable' },
        data: {}, blockResults: [],
      }))
    })
    await page.goto('/')
    await expect(page.getByRole('dialog', { name: 'Recover unsaved workspace?' })).toBeVisible()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByRole('dialog', { name: 'Recover unsaved workspace?' })).not.toBeVisible()
  })
})
