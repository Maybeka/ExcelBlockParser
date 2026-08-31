import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

async function loadWorkbookFixture(page: Page): Promise<void> {
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
}

test('searches the loaded workbook from the canvas heading', async ({ page }) => {
  await loadWorkbookFixture(page)

  const tools = page.getByLabel('Read-only workbook tools')
  await expect(tools.getByRole('button', { name: 'Search workbook' })).toBeVisible()
  await tools.getByRole('button', { name: 'Search workbook' }).click()

  const search = page.getByRole('search')
  await expect(search).toBeVisible()
  await expect(search.getByText('No results')).toHaveCount(0)

  await search.getByPlaceholder('Find in workbook').fill('Alice')
  await search.getByRole('button', { name: 'Search workbook' }).click()
  await expect(search.getByText('1/1')).toBeVisible()
  await expect(search.getByRole('button', { name: /Sheet1!A2/ })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
})

test('lets the search panel move across the application window', async ({ page }) => {
  await loadWorkbookFixture(page)
  await page.getByRole('button', { name: 'Search workbook' }).click()

  const search = page.getByRole('search')
  const inspector = page.getByRole('complementary', { name: 'Extractions' })
  await search.locator('.workbook-search-drag-handle').dragTo(inspector, { targetPosition: { x: 24, y: 80 } })

  const [after, inspectorBox] = await Promise.all([search.boundingBox(), inspector.boundingBox()])
  expect(after).not.toBeNull()
  expect(inspectorBox).not.toBeNull()
  expect(after!.x + after!.width).toBeGreaterThan(inspectorBox!.x + 8)
})
