import { expect, test } from '@playwright/test'

test.describe('M4 recovery controls', () => {
  test('undo and redo are unavailable before a workspace mutation', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled()
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
