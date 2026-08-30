import { Alert, Button, Drawer, Empty, List, Tag } from 'antd'
import { AimOutlined } from '@ant-design/icons'
import type { ParseDiagnostic } from '../types'
import { useI18n } from '../i18n'

interface DiagnosticsDrawerProps {
  open: boolean
  onClose: () => void
  parseDiagnostics: ParseDiagnostic[]
  validationErrors: string[]
  onFocus: (diagnostic: ParseDiagnostic) => void
}

export function DiagnosticsDrawer({ open, onClose, parseDiagnostics, validationErrors, onFocus }: DiagnosticsDrawerProps) {
  const { t } = useI18n()
  const count = parseDiagnostics.length + validationErrors.length
  return <Drawer title={`${t('common.diagnostics')}${count ? ` (${count})` : ''}`} open={open} onClose={onClose} width={360} zIndex={1202} destroyOnClose>
    {count === 0 ? <Empty description={t('diagnostics.none')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
      {validationErrors.map((error) => <Alert key={error} type="error" showIcon message={error} style={{ marginBottom: 8 }} />)}
      <List dataSource={parseDiagnostics} renderItem={(diagnostic) => <List.Item actions={diagnostic.blockId || diagnostic.regionId ? [<Button key="focus" size="small" type="text" icon={<AimOutlined />} onClick={() => onFocus(diagnostic)}>{t('common.locate')}</Button>] : []}>
        <List.Item.Meta
          title={<><Tag color={diagnostic.severity === 'error' ? 'error' : 'warning'}>{diagnostic.code}</Tag>{diagnostic.message}</>}
          description={diagnostic.column ? `Column: ${diagnostic.column}${diagnostic.row != null ? `, parsed row: ${diagnostic.row + 1}` : ''}` : undefined}
        />
      </List.Item>} />
    </>}
  </Drawer>
}
