import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Tabs, TreeSelect, Typography, type TreeSelectProps } from 'antd'
import { CaretRightOutlined, CodeOutlined, FileTextOutlined, FolderOpenOutlined, FunctionOutlined, StopOutlined } from '@ant-design/icons'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import type { EditorView } from '@codemirror/view'
import type { PythonProjectResult } from '../../shared/pythonRuntime'
import type { ParseResult, ProjectConfig } from '../types'
import { getBridge } from '../services/bridge'
import { projectPythonEditorTheme } from '../services/pythonEditorTheme'
import { buildPythonProjectContext } from '../services/pythonProject'
import { parsePythonArtifacts, pythonArtifactSize } from '../services/pythonArtifacts'
import { buildPythonSymbolTree, jumpToPythonOffset, listPythonSymbols, pythonNavigation, type PythonSymbolNode } from '../services/pythonNavigation'

export interface PythonProjectDialogProps {
  open: boolean
  project: ProjectConfig
  parseResult: ParseResult | null
  onSourceChange: (source: string) => void
  onClose: () => void
}

function jsonDisplay(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

const MAX_DISPLAY_CHARS = 1_000_000
const PYTHON_EDITOR_EXTENSIONS = [python(), projectPythonEditorTheme, pythonNavigation()]

function boundedDisplay(value: string): string {
  return value.length <= MAX_DISPLAY_CHARS
    ? value
    : `${value.slice(0, MAX_DISPLAY_CHARS)}\n\n... preview truncated; the complete value is still used for execution.`
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="python-project-code-block">{children || 'No output.'}</pre>
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

export function PythonProjectDialog({ open, project, parseResult, onSourceChange, onClose }: PythonProjectDialogProps) {
  const [result, setResult] = useState<PythonProjectResult | null>(null)
  const [bridgeError, setBridgeError] = useState('')
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState('')
  const [activeTab, setActiveTab] = useState('script')
  const editorRef = useRef<EditorView | null>(null)
  const source = project.pythonScript?.source ?? ''
  const [draftSource, setDraftSource] = useState(source)
  const symbols = useMemo(() => listPythonSymbols(draftSource), [draftSource])
  const symbolNodes = useMemo(() => buildPythonSymbolTree(symbols), [symbols])
  const context = useMemo(
    () => parseResult?.success ? buildPythonProjectContext(project, parseResult) : null,
    [parseResult, project.id, project.name, project.workbooks],
  )
  const contextJson = useMemo(() => context ? JSON.stringify(context) : '', [context])
  const artifactResult = useMemo(() => parsePythonArtifacts(result?.resultJson ?? ''), [result?.resultJson])
  const selectedArtifact = artifactResult.artifacts.find(artifact => artifact.path === selectedArtifactPath) ?? artifactResult.artifacts[0]

  useEffect(() => {
    if (open) setDraftSource(source)
  }, [open, source])

  useEffect(() => {
    if (!open || draftSource === source) return
    const timer = window.setTimeout(() => onSourceChange(draftSource), 400)
    return () => window.clearTimeout(timer)
  }, [draftSource, onSourceChange, open, source])

  useEffect(() => { setResult(null); setExportNotice(''); setSelectedArtifactPath('') }, [contextJson, draftSource])

  useEffect(() => {
    if (artifactResult.artifacts.length > 0 && !artifactResult.artifacts.some(artifact => artifact.path === selectedArtifactPath)) {
      setSelectedArtifactPath(artifactResult.artifacts[0].path)
    }
  }, [artifactResult.artifacts, selectedArtifactPath])

  const commitSource = useCallback(() => {
    if (draftSource !== source) onSourceChange(draftSource)
  }, [draftSource, onSourceChange, source])

  const close = () => {
    commitSource()
    onClose()
  }

  const run = async () => {
    if (!context) return
    commitSource()
    setRunning(true)
    setBridgeError('')
    setResult(null)
    const response = await getBridge().runProjectPython(draftSource, contextJson)
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
  const items = [
    {
      key: 'script',
      label: 'Script',
      children: (
        <div className="python-project-editor" aria-label="Project Python source">
          <CodeMirror
            value={draftSource}
            height="390px"
            extensions={PYTHON_EDITOR_EXTENSIONS}
            onCreateEditor={view => { editorRef.current = view }}
            onChange={setDraftSource}
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
        </div>
      ),
    },
    {
      key: 'input',
      label: 'Input',
      children: context
        ? <CodeBlock>{boundedDisplay(JSON.stringify(context, null, 2))}</CodeBlock>
        : <Typography.Text type="secondary">Run &amp; Preview the project to create Python input.</Typography.Text>,
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
          ? <Typography.Text type="secondary">The Python result did not include generated files.</Typography.Text>
          : (
            <div className="python-artifact-browser">
              <ul className="python-artifact-list" aria-label="Generated files">
                {artifactResult.artifacts.map(artifact => (
                  <li key={artifact.path}>
                    <button
                      type="button"
                      aria-label={`Preview ${artifact.path}`}
                      className={artifact.path === selectedArtifact?.path ? 'is-active' : ''}
                      onClick={() => setSelectedArtifactPath(artifact.path)}
                    >
                      <FileTextOutlined />
                      <span>{artifact.path}</span>
                      <small>{formatBytes(pythonArtifactSize(artifact))}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="python-artifact-preview">
                <header>
                  <strong>{selectedArtifact?.path}</strong>
                  <Typography.Text type="secondary">UTF-8</Typography.Text>
                </header>
                <CodeBlock>{selectedArtifact?.content ?? ''}</CodeBlock>
              </div>
            </div>
          ),
    },
    {
      key: 'output',
      label: 'Output',
      children: <CodeBlock>{boundedDisplay([result?.stdout, result?.stderr].filter(Boolean).join('\n'))}</CodeBlock>,
    },
  ]

  return (
    <Modal
      title="Project Python"
      open={open}
      width={980}
      onCancel={() => { if (!running && !exporting) close() }}
      footer={<Space>
        {exportNotice && <Typography.Text type="success" className="python-artifact-save-status" title={exportNotice}>{exportNotice}</Typography.Text>}
        {result && <Typography.Text type={result.ok ? 'success' : 'danger'}>{result.durationMs} ms</Typography.Text>}
        {artifactResult.artifacts.length > 0 && !artifactResult.error && (
          <Button icon={<FolderOpenOutlined />} loading={exporting} disabled={running} onClick={() => void exportArtifacts()}>
            Save generated files
          </Button>
        )}
        <Button onClick={close} disabled={running || exporting}>Close</Button>
        {running
          ? <Button danger icon={<StopOutlined />} onClick={cancel}>Cancel run</Button>
          : <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void run()} disabled={!draftSource.trim() || !context || exporting}>Run</Button>}
      </Space>}
      destroyOnHidden={false}
    >
      {!context && <Alert type="info" showIcon message="No current parse result" description="Run & Preview before executing the project script." style={{ marginBottom: 10 }} />}
      {bridgeError && <Alert type="error" showIcon message={bridgeError} closable onClose={() => setBridgeError('')} style={{ marginBottom: 10 }} />}
      {runtimeError && <Alert type="error" showIcon message="Python execution failed" description={<pre className="python-project-error">{runtimeError}</pre>} style={{ marginBottom: 10 }} />}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        tabBarExtraContent={activeTab === 'script' ? (
          <TreeSelect
            aria-label="Python symbols"
            className="python-project-symbols"
            placeholder="Symbols"
            suffixIcon={<FunctionOutlined />}
            treeData={symbolTreeData(symbolNodes, draftSource)}
            treeDefaultExpandAll
            treeLine
            onSelect={value => {
              if (editorRef.current) jumpToPythonOffset(editorRef.current, Number(value))
            }}
            value={null}
          />
        ) : null}
      />
    </Modal>
  )
}
