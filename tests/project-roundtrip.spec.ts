import { expect, test } from '@playwright/test'

test('saves a project and reopens its own exported JSON', async ({ page }) => {
  await page.addInitScript(() => {
    let savedContent = ''
    ;(window as any).electronAPI = {
      openXlsx: async () => ({ status: 'cancelled' }),
      readFile: async () => ({ status: 'error', error: { message: 'not configured' } }),
      saveJson: async (_name: string, content: string) => {
        savedContent = content
        return { status: 'ok', value: { filePath: '/fixtures/Roundtrip Project.json' } }
      },
      saveJsonToPath: async (_path: string, content: string) => {
        savedContent = content
        return { status: 'ok', value: { filePath: '/fixtures/Roundtrip Project.json' } }
      },
      openJson: async () => ({ status: 'ok', value: { filePath: '/fixtures/Roundtrip Project.json', content: savedContent } }),
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
  })

  await page.goto('/?e2e=1')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.locator('[role="menuitem"][data-menu-id$="-save"]').click()
  await expect(page.getByText('Saved Roundtrip Project', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Open Project' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Open another project?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Discard and open' }).click()

  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: 'Project settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await expect(settings.getByRole('textbox', { name: 'Project name' })).toHaveValue('Roundtrip Project')
})
