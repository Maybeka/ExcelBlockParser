import { expect, test } from '@playwright/test'

test('opens the embedded Python debug surface from project actions', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Python Debug/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Embedded Python Debug' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Python source' })).toHaveValue(/goccy\/go-python/)
  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(dialog.getByText('Embedded Python debug requires the Wails runtime.')).toBeVisible()
})
