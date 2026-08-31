import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

async function openProjectPython(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.getByRole('button', { name: 'Project actions' }).click()
      await page.getByRole('menuitem', { name: /Project Python/ }).click({ timeout: 1_500 })
      await expect(page.getByRole('dialog', { name: 'Project Python' })).toBeVisible({ timeout: 1_500 })
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error('Unable to open the Project Python workspace.')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('opens the project Python editor with syntax highlighting', async ({ page }) => {
  await page.goto('/?e2e=1')
  await openProjectPython(page)

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const pythonActions = page.locator('.python-header-actions')
  await expect(dialog).toBeVisible()
  const dialogBox = await dialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.x).toBe(0)
  expect(dialogBox!.y).toBe(42)
  expect(dialogBox!.width).toBe(await page.evaluate(() => window.innerWidth))
  await expect(dialog.locator('.cm-editor')).toContainText('def process(context):')
  await expect(dialog.locator('.python-project-editor > header')).toContainText('main.py')
  await expect(dialog.getByRole('button', { name: 'Code overview' })).toBeVisible()
  const editorBox = await dialog.locator('.python-project-editor').boundingBox()
  expect(editorBox).not.toBeNull()
  expect(editorBox!.height).toBeGreaterThan(700)
  const fileTree = dialog.locator('.python-package-file-tree')
  await expect(fileTree.getByText('main.py', { exact: true })).toBeVisible()
  await expect(fileTree.getByText('summary.py', { exact: true })).toBeVisible()
  await expect(pythonActions.getByRole('button', { name: 'Back to workspace' })).toBeVisible()
  await expect(pythonActions.getByRole('button', { name: 'Back to workspace' })).toHaveClass(/python-workspace-return/)
  await expect(dialog.getByRole('button', { name: 'Delete active Python file' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Project actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Diagnostics' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Add Python file' }).click()
  const fileDialog = page.getByRole('dialog', { name: 'Add Python file' })
  await fileDialog.getByRole('textbox', { name: 'Python file path' }).fill('generators/helpers.py')
  await fileDialog.getByRole('button', { name: 'Add file' }).click()
  await expect(fileTree.getByText('helpers.py', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Rename active Python file' }).click()
  const renameDialog = page.getByRole('dialog', { name: 'Rename Python file' })
  await renameDialog.getByRole('textbox', { name: 'Python file path' }).fill('generators/formatting.py')
  await renameDialog.getByRole('button', { name: 'Rename file' }).click()
  const formattingFile = fileTree.getByText('formatting.py', { exact: true })
  await expect(formattingFile).toBeVisible()
  await dialog.getByRole('button', { name: 'Set active Python file as entry' }).click()
  await expect(formattingFile.locator('..').locator('.anticon-star')).toBeVisible()
  await fileTree.getByText('main.py', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Set active Python file as entry' }).click()
  const symbolSelect = page.getByRole('combobox', { name: 'Python symbols' })
  await expect(symbolSelect).toBeVisible()
  const [symbolBox, tabBarBox] = await Promise.all([
    symbolSelect.boundingBox(),
    page.getByRole('tablist', { name: 'Python workspace sections' }).boundingBox(),
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
  await page.getByRole('tab', { name: 'Input' }).click()
  await expect(dialog.getByText('No input.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh Input' })).toBeVisible()
  await page.getByRole('tab', { name: 'Script' }).click()
  await expect(pythonActions.getByRole('button', { name: 'Run' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

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

test('navigates from an imported package function to its source file', async ({ page }) => {
  await page.goto('/?e2e=1')
  await openProjectPython(page)

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const reference = dialog.locator('.cm-line').filter({ hasText: 'return build_result(context)' }).locator('.cm-python-function')
  await expect(reference).toBeVisible()
  await reference.click()
  await page.keyboard.press('F12')

  await expect(dialog.locator('.cm-editor')).toContainText('def build_result(context):')
  const selectedFile = dialog.locator('.python-package-file-tree .ant-tree-node-selected')
  await expect(selectedFile).toContainText('summary.py')
})

test('shows hierarchical symbols and modifier-hover definition links', async ({ page }) => {
  await page.goto('/?e2e=1')
  await openProjectPython(page)

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('class Builder:\n    def render(self):\n        return helper()\n\ndef helper():\n    return 1\n\ndef process(context):\n    return helper()')

  await page.getByRole('combobox', { name: 'Python symbols' }).click()
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
  await page.goto('/?e2e=1')
  await openProjectPython(page)

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
  project.project.pythonScript = { entryPath: 'main.py', files: [{ path: 'main.py', source: 'def process(context):\n    return context["data"]\n' }] }
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
              { path: 'rtl/customer.sv', content: 'module customer;\nendmodule\n', encoding: 'utf-8' },
            ],
          }),
          stdout: '', stderr: '', error: '', hostError: '', durationMs: 8,
        },
      }),
      exportPythonArtifacts: async () => ({ status: 'ok', value: { directory: '/fixtures/generated', written: 3 } }),
    }
  }, { workbookBase64: workbook.toString('base64'), projectContent: JSON.stringify(project) })

  await page.goto('/?e2e=1')
  await page.getByRole('button', { name: 'Open Project' }).click()
  const settings = page.getByRole('dialog', { name: 'Project settings' })
  await settings.getByRole('button', { name: 'Reassign' }).click()
  await expect(page.getByRole('banner').getByText('test_data.xlsx')).toBeVisible()
  await settings.getByRole('button', { name: 'Done' }).click()
  await openProjectPython(page)

  const dialog = page.getByRole('dialog', { name: 'Project Python' })
  const pythonActions = page.locator('.python-header-actions')
  await pythonActions.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('tab', { name: 'Files (3)' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Input' }).click()
  await expect(dialog.locator('.python-project-input-json')).toBeVisible()
  await expect(dialog.locator('.python-project-input-json').getByText('blockResults', { exact: true })).toBeVisible()
  await expect(dialog.locator('.python-project-input-json').getByText('regionResults', { exact: true })).toBeVisible()
  await expect(dialog.locator('.python-project-input-json')).toContainText('block_1')
  const punctuationColors = await dialog.locator('.python-project-input-json').evaluate(node => Array.from(node.querySelectorAll('span'))
    .filter(child => ['{', '}', '[', ']', ':'].includes(child.textContent?.trim() ?? ''))
    .map(child => getComputedStyle(child).color))
  expect(new Set(punctuationColors)).toEqual(new Set(['rgb(76, 79, 105)']))
  await page.getByRole('tab', { name: 'Files (3)' }).click()
  const artifactTree = dialog.locator('.python-artifact-tree')
  await expect(artifactTree.getByText('customer.py', { exact: true })).toBeVisible()
  await expect(dialog.locator('.python-artifact-preview .shiki')).toBeVisible()
  const splitterHandle = dialog.locator('.python-artifact-browser .ant-splitter-bar')
  const handleBox = await splitterHandle.boundingBox()
  expect(handleBox).not.toBeNull()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 70, handleBox!.y + handleBox!.height / 2)
  await page.mouse.up()
  const resizedTreeBox = await artifactTree.boundingBox()
  expect(resizedTreeBox).not.toBeNull()
  await pythonActions.getByRole('button', { name: 'Run' }).click()
  await expect(artifactTree.getByText('customer.py', { exact: true })).toBeVisible()
  const refreshedTreeBox = await artifactTree.boundingBox()
  expect(refreshedTreeBox).not.toBeNull()
  expect(refreshedTreeBox!.width).toBeCloseTo(resizedTreeBox!.width, 0)
  await artifactTree.getByText('customer.json', { exact: true }).click()
  await expect(dialog.locator('.python-artifact-preview')).toContainText('{"type":"object"}')
  await expect(dialog.locator('.python-artifact-preview .shiki')).toBeVisible()
  await artifactTree.getByText('customer.sv', { exact: true }).click()
  await expect(dialog.locator('.python-artifact-preview')).toContainText('module customer')
  await expect(dialog.locator('.python-artifact-preview .shiki')).toBeVisible()
  await pythonActions.getByRole('button', { name: 'Save generated files' }).click()
  await expect(pythonActions.getByText('3 file(s) saved to /fixtures/generated')).toBeVisible()
})
