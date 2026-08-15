import { expect, test } from '@playwright/test'

test('opens the project Python editor with syntax highlighting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Project Python/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.cm-editor')).toContainText('def process(context):')
  const highlightedDef = dialog.locator('.cm-line span').filter({ hasText: /^def$/ }).first()
  await expect(highlightedDef).toBeVisible()
  await expect(highlightedDef).not.toHaveAttribute('class', '')
  await expect(dialog.getByText('No current parse result')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Run' })).toBeDisabled()
})
