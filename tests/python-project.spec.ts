import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

test('opens the project Python editor with syntax highlighting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Project Python/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.cm-editor')).toContainText('def process(context):')
  const symbolSelect = dialog.getByRole('combobox', { name: 'Python symbols' })
  await expect(symbolSelect).toBeVisible()
  const [symbolBox, tabBarBox] = await Promise.all([
    symbolSelect.boundingBox(),
    dialog.locator('.ant-tabs-nav').boundingBox(),
  ])
  expect(symbolBox).not.toBeNull()
  expect(tabBarBox).not.toBeNull()
  expect(symbolBox!.y).toBeGreaterThanOrEqual(tabBarBox!.y)
  expect(symbolBox!.y + symbolBox!.height).toBeLessThanOrEqual(tabBarBox!.y + tabBarBox!.height + 1)
  await symbolSelect.click()
  const processSymbol = page.locator('.python-project-symbol-title').filter({ hasText: 'process' })
  await expect(processSymbol).toBeVisible()
  await expect(page.locator('.python-project-symbol-icon.is-function')).toBeVisible()
  await processSymbol.click()
  const highlightedDef = dialog.locator('.cm-line span').filter({ hasText: /^def$/ }).first()
  await expect(highlightedDef).toBeVisible()
  await expect(highlightedDef).not.toHaveAttribute('class', '')
  await expect(highlightedDef).toHaveCSS('color', 'rgb(136, 57, 239)')
  await expect(dialog.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(239, 241, 245)')
  await expect(dialog.getByText('No current parse result')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Run' })).toBeDisabled()

  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.down('x')
  for (let index = 1; index < 12; index += 1) await page.keyboard.down('x')
  await page.keyboard.up('x')
  await expect(editor).toContainText('xxxxxxxxxxxx')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('def helper():\n    return 1\n\ndef process(context):\n    return helper()')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('F12')
  await expect(dialog.locator('.cm-activeLine')).toContainText('def helper():')
})

test('shows hierarchical symbols and modifier-hover definition links', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Project Python/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('class Builder:\n    def render(self):\n        return helper()\n\ndef helper():\n    return 1\n\ndef process(context):\n    return helper()')

  await dialog.getByRole('combobox', { name: 'Python symbols' }).click()
  const symbolTree = page.locator('.ant-select-tree')
  const builderLabel = symbolTree.getByText('Builder', { exact: true })
  const renderLabel = symbolTree.getByText('render', { exact: true })
  const builderTitle = builderLabel.locator('..')
  const renderTitle = renderLabel.locator('..')
  await expect(builderTitle.locator('.python-project-symbol-icon.is-class')).toBeVisible()
  await expect(renderTitle.locator('.python-project-symbol-icon.is-method')).toBeVisible()
  await expect(builderTitle).toHaveCSS('padding-left', '0px')
  await expect(renderTitle).toHaveCSS('padding-left', '12px')
  await builderTitle.click()

  const helperLine = dialog.locator('.cm-line').filter({ hasText: 'return helper()' }).last()
  const helperReference = helperLine.locator('span').filter({ hasText: /^helper$/ }).last()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const helperBox = await helperReference.boundingBox()
  expect(helperBox).not.toBeNull()
  await page.keyboard.down(modifier)
  await page.mouse.move(helperBox!.x + helperBox!.width / 2, helperBox!.y + helperBox!.height / 2)
  const definitionLink = helperLine.locator('.cm-python-definition-link')
  await expect(definitionLink).toHaveCSS('text-decoration-line', 'underline')
  await page.keyboard.up(modifier)
  await expect(definitionLink).toHaveCount(0)
})

test('distinguishes constructors and navigates through an inferred instance type', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Project Python/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('class Builder:\n    def render(self, value: int):\n        return value\n\ndef process(context):\n    builder = Builder()\n    return builder.render(1)')

  const constructor = dialog.locator('.cm-python-constructor').filter({ hasText: 'Builder' })
  const method = dialog.locator('.cm-python-method').filter({ hasText: 'render' }).last()
  await expect(constructor).toHaveCSS('color', 'rgb(23, 146, 153)')
  await expect(method).toHaveCSS('color', 'rgb(114, 135, 253)')

  await method.click()
  await page.keyboard.press('F12')
  await expect(dialog.locator('.cm-activeLine')).toContainText('def render(self, value: int):')

  await editor.fill('class Base:\n    def render(self, value: int):\n        return value\n\nclass Builder(Base):\n    pass\n\ndef process(context):\n    builder = Builder()\n    return builder')
  await editor.press('.')
  const completion = dialog.locator('.cm-tooltip-autocomplete').getByText(/render.*inherited from Base/)
  await expect(completion).toBeVisible()
})

test('previews and saves generated text files through the host bridge', async ({ page }) => {
  const [workbook, projectSource] = await Promise.all([
    readFile(resolve(root, 'examples', 'test_data.xlsx')),
    readFile(resolve(root, 'examples', 'project.json'), 'utf8'),
  ])
  const project = JSON.parse(projectSource)
  project.project.pythonScript = { source: 'def process(context):\n    return context["data"]\n' }
  project.data = { 'example-workbook': { block_1: [{ name: 'Alice' }] } }
  project.blockResults = [{ blockId: 'example-block', label: 'block_1', workbookId: 'example-workbook', data: [{ name: 'Alice' }], rowCount: 1 }]

  await page.addInitScript(({ workbookBase64, projectContent }) => {
    const workbookBytes = () => {
      const binary = atob(workbookBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return bytes.buffer
    }
    ;(window as any).electronAPI = {
      openXlsx: async () => ({ status: 'ok', value: '/fixtures/test_data.xlsx' }),
      readFile: async () => ({ status: 'ok', value: workbookBytes() }),
      saveJson: async () => ({ status: 'ok', value: { filePath: '/fixtures/project.json' } }),
      saveJsonToPath: async (filePath: string) => ({ status: 'ok', value: { filePath } }),
      openJson: async () => ({ status: 'ok', value: { filePath: '/fixtures/project.json', content: projectContent } }),
      saveRecovery: async () => ({ status: 'ok', value: undefined }),
      loadRecovery: async () => ({ status: 'ok', value: null }),
      clearRecovery: async () => ({ status: 'ok', value: undefined }),
      log: () => undefined,
      openPreviewWindow: async () => undefined,
      setPreviewData: async () => undefined,
      getPreviewData: async () => undefined,
      closePreviewWindow: async () => undefined,
      onPreviewReload: () => () => undefined,
      cancelPythonRun: async () => ({ status: 'ok', value: false }),
      runProjectPython: async () => ({
        status: 'ok',
        value: {
          ok: true,
          resultJson: JSON.stringify({
            result: { generated: 2 },
            artifacts: [
              { path: 'models/customer.py', content: 'class Customer:\n    pass\n', encoding: 'utf-8' },
              { path: 'schema/customer.json', content: '{"type":"object"}', encoding: 'utf-8' },
            ],
          }),
          stdout: '', stderr: '', error: '', hostError: '', durationMs: 8,
        },
      }),
      exportPythonArtifacts: async () => ({ status: 'ok', value: { directory: '/fixtures/generated', written: 2 } }),
    }
  }, { workbookBase64: workbook.toString('base64'), projectContent: JSON.stringify(project) })

  await page.goto('/')
  await page.getByRole('button', { name: 'Open Project' }).click()
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await settings.getByRole('button', { name: 'Reassign' }).click()
  await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
  await settings.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Run & Preview' }).click()
  const closePreview = page.getByRole('button', { name: 'Close preview' })
  await expect(closePreview).toBeVisible()
  await closePreview.click()
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.getByRole('menuitem', { name: /Project Python/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(dialog.getByRole('tab', { name: 'Files (2)' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('button', { name: 'Preview models/customer.py' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Preview schema/customer.json' }).click()
  await expect(dialog.locator('.python-artifact-preview')).toContainText('{"type":"object"}')
  await dialog.getByRole('button', { name: 'Save generated files' }).click()
  await expect(dialog.getByText('2 file(s) saved to /fixtures/generated')).toBeVisible()
})
