import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Tabs, Typography } from 'antd'
import { CaretRightOutlined, StopOutlined } from '@ant-design/icons'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import type { PythonProjectResult } from '../../shared/pythonRuntime'
import type { ParseResult, ProjectConfig } from '../types'
import { getBridge } from '../services/bridge'
import { buildPythonProjectContext } from '../services/pythonProject'

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

function boundedDisplay(value: string): string {
  return value.length <= MAX_DISPLAY_CHARS
    ? value
    : `${value.slice(0, MAX_DISPLAY_CHARS)}\n\n... preview truncated; the complete value is still used for execution.`
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="python-project-code-block">{children || 'No output.'}</pre>
}

export function PythonProjectDialog({ open, project, parseResult, onSourceChange, onClose }: PythonProjectDialogProps) {
  const [result, setResult] = useState<PythonProjectResult | null>(null)
  const [bridgeError, setBridgeError] = useState('')
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState('script')
  const source = project.pythonScript?.source ?? ''
  const context = useMemo(
    () => parseResult?.success ? buildPythonProjectContext(project, parseResult) : null,
    [parseResult, project.id, project.name, project.workbooks],
  )
  const contextJson = useMemo(() => context ? JSON.stringify(context) : '', [context])

  useEffect(() => { setResult(null) }, [contextJson, source])

  const run = async () => {
    if (!context) return
    setRunning(true)
    setBridgeError('')
    setResult(null)
    const response = await getBridge().runProjectPython(source, contextJson)
    setRunning(false)
    if (response.status === 'ok') {
      setResult(response.value)
      if (response.value.ok) setActiveTab('result')
    }
    else setBridgeError(response.status === 'error' ? response.error.message : 'Python run was cancelled.')
  }

  const cancel = async () => {
    const response = await getBridge().cancelPythonRun()
    if (response.status === 'error') setBridgeError(response.error.message)
  }

  const runtimeError = result?.hostError || result?.error
  const items = [
    {
      key: 'script',
      label: 'Script',
      children: (
        <div className="python-project-editor" aria-label="Project Python source">
          <CodeMirror
            value={source}
            height="390px"
            extensions={[python()]}
            onChange={onSourceChange}
            editable={!running}
            basicSetup={{
              autocompletion: false,
              bracketMatching: true,
              closeBrackets: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              lineNumbers: true,
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
      onCancel={() => { if (!running) onClose() }}
      footer={<Space>
        {result && <Typography.Text type={result.ok ? 'success' : 'danger'}>{result.durationMs} ms</Typography.Text>}
        <Button onClick={onClose} disabled={running}>Close</Button>
        {running
          ? <Button danger icon={<StopOutlined />} onClick={cancel}>Cancel run</Button>
          : <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void run()} disabled={!source.trim() || !context}>Run</Button>}
      </Space>}
      destroyOnHidden={false}
    >
      {!context && <Alert type="info" showIcon message="No current parse result" description="Run & Preview before executing the project script." style={{ marginBottom: 10 }} />}
      {bridgeError && <Alert type="error" showIcon message={bridgeError} closable onClose={() => setBridgeError('')} style={{ marginBottom: 10 }} />}
      {runtimeError && <Alert type="error" showIcon message="Python execution failed" description={<pre className="python-project-error">{runtimeError}</pre>} style={{ marginBottom: 10 }} />}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />
    </Modal>
  )
}
