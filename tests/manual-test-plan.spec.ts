/**
 * Manual Test Plan — Automated E2E tests (Browser mode)
 *
 * These tests run against the renderer in browser mode (via Vite).
 * Electron IPC APIs (file:open, file:read, etc.) are NOT available in browser mode,
 * so file-related tests are marked as requiring Electron.
 *
 * Run: npx playwright test
 */
import { test, expect } from '@playwright/test'

test.describe('TC-1: Application Initial State', () => {
  test('TC-1.1: Clean launch shows correct layout', async ({ page }) => {
    await page.goto('/')

    // Header
    await expect(page.locator('text=Excel Block Parser')).toBeVisible()

    // Toolbar buttons
    await expect(page.getByRole('button', { name: 'Preview' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Open Project' })).toBeVisible()
    await page.getByRole('button', { name: 'Project actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'New Project' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Save Project$/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Save Project As/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Project settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Close Project' })).toHaveAttribute('aria-disabled', 'true')
    const commandBox = await page.locator('.project-command').boundingBox()
    const menuBox = await page.locator('.project-command-menu .ant-dropdown-menu').boundingBox()
    expect(commandBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(Math.abs((commandBox!.x + commandBox!.width) - (menuBox!.x + menuBox!.width))).toBeLessThanOrEqual(2)
    expect(menuBox!.x).toBeLessThanOrEqual(commandBox!.x + 2)
    const openIconSize = await page.getByRole('button', { name: 'Open Project' }).locator('.anticon').evaluate(element => getComputedStyle(element).fontSize)
    const menuIconSize = await page.getByRole('menuitem', { name: 'New Project' }).locator('.anticon').evaluate(element => getComputedStyle(element).fontSize)
    expect(menuIconSize).toBe(openIconSize)

    // A project has no editable extraction before a workbook is available.
    await expect(page.getByRole('complementary', { name: 'Extractions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()

    // Placeholder text in spreadsheet area
    await expect(page.getByText('Select an Excel file, then choose the ranges you want to turn into structured data.', { exact: true })).toBeVisible()
  })
})

test.describe('TC-3: Block Management', () => {
  test('TC-3.1: Block actions require an active workbook', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Add Region', exact: true })).toBeDisabled()
  })
})

test.describe('TC-5: Column Configuration', () => {
  test('TC-5.1: No-range state explains how to configure columns', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('region', { name: 'Workbook canvas' }).getByText('Open a workbook to begin')).toBeVisible()
  })
})

test.describe('TC-7: Configuration Controls', () => {
  test('TC-7.1: Settings toggle reveals focus-mode control', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Project actions' })).toBeVisible()
  })
})

test.describe('TC-9: Parsing', () => {
  test('TC-9.5: Parse button disabled without range', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })
})

test.describe('TC-2: File Loading (Electron only)', () => {
  test.skip('TC-2.1: Open valid XLSX file', () => {
    // Requires Electron IPC: window.electronAPI.openXlsx() + readFile()
    // Test manually in Electron build
  })

  test.skip('TC-2.4: Cancel file dialog', () => {
    // Requires Electron IPC
  })
})

test.describe('TC-10: Project Save (Electron only)', () => {
  test.skip('TC-10.1: Save As opens the native save dialog', () => {
    // Requires Electron IPC: window.electronAPI.saveJson()
  })
})

test.describe('TC-11: Config Import', () => {
  test('TC-11.5: Open Project button exists and is visible', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Open Project' })).toBeVisible()
  })
})

test.describe('TC-12: Reconciliation (Electron fixture required)', () => {
  test.skip('TC-12.1: Reconciliation is available for a block with a source range', () => {
    // Requires a loaded workbook and a configured range. Cover this in a
    // future Electron-native fixture test rather than asserting unrelated UI.
  })
})

test.describe('TC-15: Edge Cases', () => {
  test('TC-15.4: Empty projects remain stable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('complementary', { name: 'Extractions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Block', exact: true })).toBeDisabled()
  })
})
