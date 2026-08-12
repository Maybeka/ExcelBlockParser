import { useState } from 'react'
import { Alert, Button, Input, Modal, Space, Spin, Tabs, Typography } from 'antd'
import { CaretRightOutlined, StopOutlined } from '@ant-design/icons'
import type { PythonDebugResult } from '../../shared/pythonDebug'
import { getBridge } from '../services/bridge'

const DEFAULT_SOURCE = `import json

payload = {
    "runtime": "goccy/go-python",
    "values": [value * value for value in range(5)],
}

print(json.dumps(payload, indent=2))
`

export interface PythonDebugDialogProps {
  open: boolean
  onClose: () => void
}

function OutputPane({ result }: { result: PythonDebugResult | null }) {
  if (!result) return <Typography.Text type="secondary">No run result.</Typography.Text>
  const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : '')
  return (
    <div className="python-debug-result">
      {(result.hostError || result.error) && <Alert type="error" showIcon message={result.hostError || result.error} />}
      {result.ok && !output && result.repr && <pre>{result.repr}</pre>}
      {output && <pre>{output}</pre>}
      <Typography.Text type="secondary">{result.durationMs} ms</Typography.Text>
    </div>
  )
}

export function PythonDebugDialog({ open, onClose }: PythonDebugDialogProps) {
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [result, setResult] = useState<PythonDebugResult | null>(null)
  const [bridgeError, setBridgeError] = useState('')
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setBridgeError('')
    setResult(null)
    const response = await getBridge().runPythonDebug(source)
    setRunning(false)
    if (response.status === 'ok') setResult(response.value)
    else setBridgeError(response.status === 'error' ? response.error.message : 'Python run was cancelled.')
  }

  const cancel = async () => {
    const response = await getBridge().cancelPythonDebug()
    if (response.status === 'error') setBridgeError(response.error.message)
  }

  return (
    <Modal
      title="Embedded Python Debug"
      open={open}
      width={920}
      onCancel={() => { if (!running) onClose() }}
      footer={<Space>
        <Button onClick={onClose} disabled={running}>Close</Button>
        {running
          ? <Button danger icon={<StopOutlined />} onClick={cancel}>Cancel run</Button>
          : <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void run()} disabled={!source.trim()}>Run</Button>}
      </Space>}
      destroyOnHidden={false}
    >
      {bridgeError && <Alert type="error" showIcon message={bridgeError} closable onClose={() => setBridgeError('')} style={{ marginBottom: 10 }} />}
      <Input.TextArea
        aria-label="Python source"
        value={source}
        onChange={event => setSource(event.target.value)}
        autoSize={{ minRows: 14, maxRows: 22 }}
        spellCheck={false}
        className="python-debug-editor"
        disabled={running}
      />
      <div className="python-debug-output">
        <Tabs size="small" items={[{ key: 'output', label: 'Output', children: running ? <Spin size="small" /> : <OutputPane result={result} /> }]} />
      </div>
    </Modal>
  )
}
