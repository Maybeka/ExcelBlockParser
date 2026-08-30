import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Input, Modal, Space, Spin, Splitter, Tabs, Tree, TreeSelect, Typography, type TreeSelectProps } from 'antd'
import { ArrowLeftOutlined, CaretRightOutlined, CodeOutlined, DeleteOutlined, EditOutlined, FileAddOutlined, FileTextOutlined, FolderOpenOutlined, FunctionOutlined, ReloadOutlined, StarFilled, StopOutlined } from '@ant-design/icons'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import type { EditorView } from '@codemirror/view'
import type { PythonArtifact, PythonProjectResult } from '../../shared/pythonRuntime'
import type { ParseResult, ProjectConfig, PythonScriptConfig } from '../types'
import { getBridge } from '../services/bridge'
import { projectPythonEditorTheme } from '../services/pythonEditorTheme'
import { buildPythonProjectContext } from '../services/pythonProject'
import { parsePythonArtifacts, pythonArtifactSize } from '../services/pythonArtifacts'
import { buildPythonSymbolTree, jumpToPythonOffset, listPythonSymbols, pythonNavigation, type PythonSymbolNode } from '../services/pythonNavigation'
import { createPythonPackage, normalizePythonPath, sourceForPythonFile, validatePythonPackage } from '../services/pythonPackage'
import { highlightPreview, type PreviewLanguage } from '../services/syntaxPreview'
import { resolvePythonPackageDefinition, type PythonExternalDefinition } from '../services/pythonPackageNavigation'
import { JsonTreeView } from './JsonTreeView'

export interface PythonProjectDialogProps {
  open: boolean
  project: ProjectConfig
  parseResult: ParseResult | null
  onPrepareInput: () => Promise<{ project: ProjectConfig; result: ParseResult } | { error: string }>
  onSourceChange: (pythonScript: PythonScriptConfig) => void
  onClose: () => void
  toolbarContainer: HTMLElement | null
  tabBarContainer: HTMLElement | null
}

function jsonDisplay(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

const MAX_DISPLAY_CHARS = 1_000_000

function boundedDisplay(value: string): string {
  return value.length <= MAX_DISPLAY_CHARS
    ? value
    : `${value.slice(0, MAX_DISPLAY_CHARS)}\n\n... preview truncated; the complete value is still used for execution.`
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="python-project-code-block">{children || 'No output.'}</pre>
}

function CodeOverview({ source, onNavigate }: { source: string; onNavigate: (offset: number) => void }) {
  const lines = source.split('\n')
  const step = Math.max(1, Math.ceil(lines.length / 800))
  const overview = lines.filter((_line, index) => index % step === 0).join('\n')

  return (
    <button
      type="button"
      className="python-code-overview"
      aria-label="Code overview"
      title="Click to navigate the code"
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
        const line = Math.round(ratio * Math.max(0, lines.length - 1))
        onNavigate(lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0))
      }}
    >
      <pre>{overview}</pre>
    </button>
  )
}

function PythonInputJson({ value }: { value: unknown }) {
  return (
    <JsonTreeView
      value={value as Record<string, unknown>}
      className="python-project-input-json"
      shouldCollapse={({ name, namespace }) => {
          if (name === false) return false
          const rootBranch = namespace.find(part => typeof part === 'string')
          return rootBranch !== 'blockResults' && rootBranch !== 'regionResults'
      }}
    />
  )
}

function previewLanguage(path: string): PreviewLanguage | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.py')) return 'python'
  if (/\.(?:sv|svh|v|vh)$/.test(lower)) return 'system-verilog'
  return null
}

function SyntaxPreview({ path, content }: { path: string; content: string }) {
  const [html, setHtml] = useState('')
  const language = previewLanguage(path)
  const preview = boundedDisplay(content)

  useEffect(() => {
    let active = true
    if (!language) { setHtml(''); return () => { active = false } }
    void highlightPreview(preview, language)
      .then(value => { if (active) setHtml(value) })
      .catch(() => { if (active) setHtml('') })
    return () => { active = false }
  }, [language, preview])

  return html
    ? <div className="python-syntax-preview" dangerouslySetInnerHTML={{ __html: html }} />
    : <CodeBlock>{preview}</CodeBlock>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function symbolTreeData(nodes: PythonSymbolNode[], source: string, depth = 0): NonNullable<TreeSelectProps['treeData']> {
  return nodes.map(node => ({
    value: String(node.symbol.from),
    title: (
      <span className="python-project-symbol-title" style={{ paddingLeft: depth * 12 }}>
        <span className={`python-project-symbol-icon is-${node.symbol.kind}`}>
          {node.symbol.kind === 'class' ? <CodeOutlined /> : <FunctionOutlined />}
        </span>
        <span>{node.symbol.name}</span>
        <small>line {source.slice(0, node.symbol.from).split('\n').length}</small>
      </span>
    ),
    children: symbolTreeData(node.children, source, depth + 1),
  }))
}

interface PackageTreeNode { key: string; title: ReactNode; children?: PackageTreeNode[] }

function packageTreeData(files: PythonScriptConfig['files'], entryPath: string): PackageTreeNode[] {
  type MutableNode = PackageTreeNode & { children: PackageTreeNode[]; index: Map<string, MutableNode> }
  const root: MutableNode = { key: '__root__', title: '', children: [], index: new Map() }
  for (const file of files) {
    const parts = file.path.split('/')
    let parent = root
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1
      let node = parent.index.get(part)
      if (!node) {
        node = {
          key: isFile ? file.path : `dir:${parts.slice(0, index + 1).join('/')}`,
          title: isFile ? <span className="python-package-tree-file"><FileTextOutlined />{part}{file.path === entryPath && <StarFilled title="Entry file" />}</span> : <span className="python-package-tree-folder"><FolderOpenOutlined />{part}</span>,
          children: [], index: new Map(),
        }
        parent.index.set(part, node)
        parent.children.push(node)
      }
      parent = node
    }
  }
  const strip = (node: MutableNode): PackageTreeNode => ({ key: node.key, title: node.title, ...(node.children.length ? { children: node.children.map(strip) } : {}) })
  return root.children.map(strip)
}

function artifactTreeData(artifacts: PythonArtifact[]): PackageTreeNode[] {
  type MutableNode = PackageTreeNode & { children: MutableNode[]; index: Map<string, MutableNode> }
  const root: MutableNode = { key: '__artifact_root__', title: '', children: [], index: new Map() }
  for (const artifact of artifacts) {
    const parts = artifact.path.split('/')
    let parent = root
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1
      let node = parent.index.get(part)
      if (!node) {
        node = {
          key: isFile ? artifact.path : `artifact-dir:${parts.slice(0, index + 1).join('/')}`,
          title: isFile
            ? <span className="python-artifact-tree-file"><FileTextOutlined /><span>{part}</span><small>{formatBytes(pythonArtifactSize(artifact))}</small></span>
            : <span className="python-package-tree-folder"><FolderOpenOutlined />{part}</span>,
          children: [], index: new Map(),
        }
        parent.index.set(part, node)
        parent.children.push(node)
      }
      parent = node
    }
  }
  const strip = (node: MutableNode): PackageTreeNode => ({ key: node.key, title: node.title, ...(node.children.length ? { children: node.children.map(strip) } : {}) })
  return root.children.map(strip)
}

export function PythonProjectDialog({ open, project, parseResult, onPrepareInput, onSourceChange, onClose, toolbarContainer, tabBarContainer }: PythonProjectDialogProps) {
  const [result, setResult] = useState<PythonProjectResult | null>(null)
  const [bridgeError, setBridgeError] = useState('')
  const [running, setRunning] = useState(false)
  const [preparingInput, setPreparingInput] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState('')
  const [activeTab, setActiveTab] = useState('script')
  const [fileDialog, setFileDialog] = useState<{ mode: 'add' | 'rename'; value: string } | null>(null)
  const [preparedContext, setPreparedContext] = useState<ReturnType<typeof buildPythonProjectContext> | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const pendingExternalJumpRef = useRef<PythonExternalDefinition | null>(null)
  const lastRunInputKeyRef = useRef('')
  const pythonScript = project.pythonScript ?? createPythonPackage()
  const [draftPackage, setDraftPackage] = useState<PythonScriptConfig>(pythonScript)
  const [activeFilePath, setActiveFilePath] = useState(pythonScript.entryPath)
  const draftSource = sourceForPythonFile(draftPackage, activeFilePath)
  const resolveExternal = useCallback((source: string, position: number) => resolvePythonPackageDefinition(draftPackage.files, source, position), [draftPackage.files])
  const openExternal = useCallback((target: PythonExternalDefinition) => {
    pendingExternalJumpRef.current = target
    setActiveFilePath(target.filePath)
  }, [])
  const pythonEditorExtensions = useMemo(() => [python(), projectPythonEditorTheme, pythonNavigation({ resolveExternal, openExternal })], [openExternal, resolveExternal])
  const symbols = useMemo(() => listPythonSymbols(draftSource), [draftSource])
  const symbolNodes = useMemo(() => buildPythonSymbolTree(symbols), [symbols])
  const parsedContext = useMemo(
    () => parseResult?.success ? buildPythonProjectContext(project, parseResult) : null,
    [parseResult, project.id, project.name, project.workbooks],
  )
  const context = preparedContext ?? parsedContext
  const contextJson = useMemo(() => context ? JSON.stringify(context) : '', [context])
  const inputKey = `${JSON.stringify(draftPackage)}\u0000${contextJson}`
  const artifactResult = useMemo(() => parsePythonArtifacts(result?.resultJson ?? ''), [result?.resultJson])
  const selectedArtifact = artifactResult.artifacts.find(artifact => artifact.path === selectedArtifactPath) ?? artifactResult.artifacts[0]

  useEffect(() => {
    if (open) {
      setDraftPackage(pythonScript)
      setActiveFilePath(pythonScript.entryPath)
      setResult(null)
      setExportNotice('')
      setSelectedArtifactPath('')
    }
  }, [open, project.id])

  useEffect(() => {
    if (!open) {
      setPreparedContext(null)
      setResult(null)
      setExportNotice('')
      setSelectedArtifactPath('')
    }
  }, [open])

  useEffect(() => {
    const pending = pendingExternalJumpRef.current
    if (!pending || pending.filePath !== activeFilePath || !editorRef.current) return
    const frame = window.requestAnimationFrame(() => {
      if (editorRef.current) jumpToPythonOffset(editorRef.current, pending.definition.from)
      pendingExternalJumpRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeFilePath, draftSource])

  useEffect(() => {
    if (!open || JSON.stringify(draftPackage) === JSON.stringify(pythonScript)) return
    const timer = window.setTimeout(() => onSourceChange(draftPackage), 400)
    return () => window.clearTimeout(timer)
  }, [draftPackage, onSourceChange, open, pythonScript])

  useEffect(() => {
    if (inputKey === lastRunInputKeyRef.current) return
    setExportNotice('')
  }, [inputKey])

  useEffect(() => {
    if (artifactResult.artifacts.length > 0 && !artifactResult.artifacts.some(artifact => artifact.path === selectedArtifactPath)) {
      setSelectedArtifactPath(artifactResult.artifacts[0].path)
    }
  }, [artifactResult.artifacts, selectedArtifactPath])

  const commitSource = useCallback(() => {
    if (JSON.stringify(draftPackage) !== JSON.stringify(pythonScript)) onSourceChange(draftPackage)
  }, [draftPackage, onSourceChange, pythonScript])

  const close = () => {
    commitSource()
    onClose()
  }

  const run = async () => {
    commitSource()
    setRunning(true)
    setBridgeError('')
    const prepared = await onPrepareInput()
    if ('error' in prepared) {
      setBridgeError(prepared.error)
      setRunning(false)
      return
    }
    const nextContext = buildPythonProjectContext(prepared.project, prepared.result)
    const nextContextJson = JSON.stringify(nextContext)
    const packageError = validatePythonPackage(draftPackage)
    if (packageError) {
      setBridgeError(packageError)
      setRunning(false)
      return
    }
    lastRunInputKeyRef.current = `${JSON.stringify(draftPackage)}\u0000${nextContextJson}`
    setPreparedContext(nextContext)
    const response = await getBridge().runProjectPython(draftPackage, nextContextJson)
    setRunning(false)
    if (response.status === 'ok') {
      setResult(response.value)
      if (response.value.ok) {
        const parsedArtifacts = parsePythonArtifacts(response.value.resultJson)
        setActiveTab(parsedArtifacts.artifacts.length > 0 || parsedArtifacts.error ? 'files' : 'result')
      }
    }
    else setBridgeError(response.status === 'error' ? response.error.message : 'Python run was cancelled.')
  }

  const prepareInput = async () => {
    setPreparingInput(true)
    setBridgeError('')
    const prepared = await onPrepareInput()
    setPreparingInput(false)
    if ('error' in prepared) {
      setBridgeError(prepared.error)
      return
    }
    setPreparedContext(buildPythonProjectContext(prepared.project, prepared.result))
  }

  const cancel = async () => {
    const response = await getBridge().cancelPythonRun()
    if (response.status === 'error') setBridgeError(response.error.message)
  }

  const exportArtifacts = async () => {
    if (!artifactResult.artifacts.length) return
    setExporting(true)
    setBridgeError('')
    setExportNotice('')
    const response = await getBridge().exportPythonArtifacts(project.name, artifactResult.artifacts)
    setExporting(false)
    if (response.status === 'ok') setExportNotice(`${response.value.written} file(s) saved to ${response.value.directory}`)
    else if (response.status === 'error') setBridgeError(response.error.message)
  }

  const runtimeError = result?.hostError || result?.error
  const updateActiveFileSource = (nextSource: string) => {
    setDraftPackage(current => ({ ...current, files: current.files.map(file => file.path === activeFilePath ? { ...file, source: nextSource } : file) }))
  }
  const submitFileDialog = () => {
    if (!fileDialog) return
    const path = normalizePythonPath(fileDialog.value)
    if (!path) {
      setBridgeError('Python file paths must be relative .py paths without empty, . or .. segments.')
      return
    }
    if (fileDialog.mode === 'add') {
    if (draftPackage.files.some(file => file.path.toLocaleLowerCase('en-US') === path.toLocaleLowerCase('en-US'))) {
      setBridgeError(`A Python file already exists at ${path}.`)
      return
    }
    setDraftPackage(current => ({ ...current, files: [...current.files, { path, source: '' }] }))
    setActiveFilePath(path)
    setFileDialog(null)
    return
    }
    if (path === activeFilePath) { setFileDialog(null); return }
    if (draftPackage.files.some(file => file.path !== activeFilePath && file.path.toLocaleLowerCase('en-US') === path.toLocaleLowerCase('en-US'))) {
      setBridgeError(`A Python file already exists at ${path}.`)
      return
    }
    setDraftPackage(current => ({
      entryPath: current.entryPath === activeFilePath ? path : current.entryPath,
      files: current.files.map(file => file.path === activeFilePath ? { ...file, path } : file),
    }))
    setActiveFilePath(path)
    setFileDialog(null)
  }
  const deleteActiveFile = () => {
    if (draftPackage.files.length <= 1 || activeFilePath === draftPackage.entryPath || !window.confirm(`Delete ${activeFilePath}?`)) return
    const nextFiles = draftPackage.files.filter(file => file.path !== activeFilePath)
    setDraftPackage(current => ({ ...current, files: nextFiles }))
    setActiveFilePath(nextFiles[0].path)
  }
  const setEntryFile = () => setDraftPackage(current => ({ ...current, entryPath: activeFilePath }))
  const items = [
    {
      key: 'script',
      label: 'Script',
      children: (
        <Splitter className="python-project-script-splitter">
          <Splitter.Panel defaultSize={230} min={160} max="50%">
            <aside className="python-package-files" aria-label="Python project files">
              <header>
                <strong>Files</strong>
                <Space.Compact size="small">
                  <Button type="text" size="small" icon={<FileAddOutlined />} aria-label="Add Python file" title="Add Python file" onClick={() => setFileDialog({ mode: 'add', value: 'helpers.py' })} />
                  <Button type="text" size="small" icon={<StarFilled />} aria-label="Set active Python file as entry" title="Set active file as entry" onClick={setEntryFile} disabled={running || exporting || activeFilePath === draftPackage.entryPath} />
                  <Button type="text" size="small" icon={<EditOutlined />} aria-label="Rename active Python file" title="Rename active file" onClick={() => setFileDialog({ mode: 'rename', value: activeFilePath })} disabled={running || exporting} />
                  <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label="Delete active Python file" title="Delete active file" onClick={deleteActiveFile} disabled={running || exporting || draftPackage.files.length <= 1 || activeFilePath === draftPackage.entryPath} />
                </Space.Compact>
              </header>
              <Tree
                className="python-package-file-tree"
                aria-label="Python project files"
                blockNode
                defaultExpandAll
                selectedKeys={[activeFilePath]}
                treeData={packageTreeData(draftPackage.files, draftPackage.entryPath)}
                onSelect={keys => {
                  const path = String(keys[0] ?? '')
                  if (draftPackage.files.some(file => file.path === path)) setActiveFilePath(path)
                }}
              />
            </aside>
          </Splitter.Panel>
          <Splitter.Panel min="40%">
            <div className="python-project-editor" aria-label="Project Python source">
              <header>
                <strong>{activeFilePath}</strong>
                <Typography.Text type="secondary">Python</Typography.Text>
              </header>
              <div className="python-editor-surface">
                <CodeMirror
                  value={draftSource}
                  height="100%"
                  extensions={pythonEditorExtensions}
                  onCreateEditor={view => { editorRef.current = view }}
                  onChange={updateActiveFileSource}
                  editable={!running}
                  basicSetup={{
                    autocompletion: false,
                    bracketMatching: true,
                    closeBrackets: true,
                    foldGutter: true,
                    highlightActiveLine: true,
                    highlightSelectionMatches: true,
                    lineNumbers: true,
                    syntaxHighlighting: false,
                  }}
                />
                <CodeOverview source={draftSource} onNavigate={offset => { if (editorRef.current) jumpToPythonOffset(editorRef.current, offset) }} />
              </div>
            </div>
          </Splitter.Panel>
        </Splitter>
      ),
    },
    {
      key: 'input',
      label: 'Input',
      children: context
        ? <PythonInputJson value={context} />
        : <CodeBlock>No input.</CodeBlock>,
    },
    {
      key: 'result',
      label: 'Result',
      children: running
        ? <Spin size="small" />
        : <CodeBlock>{result?.resultJson ? boundedDisplay(jsonDisplay(result.resultJson)) : ''}</CodeBlock>,
    },
    {
      key: 'files',
      label: artifactResult.artifacts.length ? `Files (${artifactResult.artifacts.length})` : 'Files',
      children: artifactResult.error
        ? <Alert type="error" showIcon message="Generated files are invalid" description={artifactResult.error} />
        : artifactResult.artifacts.length === 0
          ? <CodeBlock>No generated files.</CodeBlock>
          : (
            <Splitter className="python-artifact-browser">
              <Splitter.Panel defaultSize="34%" min={180} max="60%">
                <Tree
                  className="python-artifact-tree"
                  aria-label="Generated files"
                  blockNode
                  defaultExpandAll
                  selectedKeys={selectedArtifact ? [selectedArtifact.path] : []}
                  treeData={artifactTreeData(artifactResult.artifacts)}
                  onSelect={keys => {
                    const path = String(keys[0] ?? '')
                    if (artifactResult.artifacts.some(artifact => artifact.path === path)) setSelectedArtifactPath(path)
                  }}
                />
              </Splitter.Panel>
              <Splitter.Panel min="30%">
                <div className="python-artifact-preview">
                  <header>
                    <strong>{selectedArtifact?.path}</strong>
                    <Typography.Text type="secondary">UTF-8</Typography.Text>
                  </header>
                  {selectedArtifact && <SyntaxPreview path={selectedArtifact.path} content={selectedArtifact.content} />}
                </div>
              </Splitter.Panel>
            </Splitter>
          ),
    },
    {
      key: 'output',
      label: 'Output',
      children: <CodeBlock>{boundedDisplay([result?.stdout, result?.stderr].filter(Boolean).join('\n'))}</CodeBlock>,
    },
  ]

  const toolbar = (
    <Space className="python-workspace-actions" size={6}>
      <Button className="python-workspace-return" type="primary" icon={<ArrowLeftOutlined />} onClick={close} disabled={running || exporting}>
        Back to workspace
      </Button>
      {exportNotice && <Typography.Text type="success" className="python-artifact-save-status" title={exportNotice}>{exportNotice}</Typography.Text>}
      {result && <Typography.Text type={result.ok ? 'success' : 'danger'}>{result.durationMs} ms</Typography.Text>}
      {artifactResult.artifacts.length > 0 && !artifactResult.error && (
        <Button icon={<FolderOpenOutlined />} loading={exporting} disabled={running} onClick={() => void exportArtifacts()}>
          Save generated files
        </Button>
      )}
      {running
        ? <Button danger icon={<StopOutlined />} onClick={cancel}>Cancel run</Button>
        : <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void run()} disabled={!draftPackage.files.some(file => file.path === draftPackage.entryPath && file.source.trim()) || exporting}>Run</Button>}
    </Space>
  )

  const headerTabs = (
    <div className="python-header-tab-list" role="tablist" aria-label="Python workspace sections">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={activeTab === item.key}
          className={activeTab === item.key ? 'is-active' : ''}
          onClick={() => setActiveTab(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )

  const toolbarExtras = activeTab === 'script' ? (
    <TreeSelect
      aria-label="Python symbols"
      className="python-project-symbols"
      size="small"
      placeholder="Symbols"
      suffixIcon={<FunctionOutlined />}
      treeData={symbolTreeData(symbolNodes, draftSource)}
      treeDefaultExpandAll
      treeLine
      getPopupContainer={trigger => trigger.parentElement ?? document.body}
      onSelect={value => {
        if (editorRef.current) jumpToPythonOffset(editorRef.current, Number(value))
      }}
      value={null}
    />
  ) : activeTab === 'input' ? (
    <Button size="small" icon={<ReloadOutlined />} loading={preparingInput} disabled={running || exporting} onClick={() => void prepareInput()}>Refresh Input</Button>
  ) : null

  if (!open) return null

  return (
    <>
      <section className="python-project-workspace" role="dialog" aria-modal="true" aria-label="Project Python">
        <div className="python-project-workspace-body">
      {bridgeError && <Alert type="error" showIcon message={bridgeError} closable onClose={() => setBridgeError('')} style={{ marginBottom: 10 }} />}
      {runtimeError && <Alert type="error" showIcon message="Python execution failed" description={<pre className="python-project-error">{runtimeError}</pre>} style={{ marginBottom: 10 }} />}
      <Tabs
        className="python-project-tabs"
        size="small"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
      />
        </div>
        <Modal
        open={fileDialog !== null}
        zIndex={1204}
        title={fileDialog?.mode === 'add' ? 'Add Python file' : 'Rename Python file'}
        okText={fileDialog?.mode === 'add' ? 'Add file' : 'Rename file'}
        onCancel={() => setFileDialog(null)}
        onOk={submitFileDialog}
      >
        <Input
          aria-label="Python file path"
          autoFocus
          value={fileDialog?.value ?? ''}
          placeholder="generators/models.py"
          onChange={event => setFileDialog(current => current ? { ...current, value: event.target.value } : null)}
          onPressEnter={submitFileDialog}
        />
        </Modal>
      </section>
      {toolbarContainer && createPortal(<>{toolbarExtras}{toolbar}</>, toolbarContainer)}
      {tabBarContainer && createPortal(headerTabs, tabBarContainer)}
    </>
  )
}
