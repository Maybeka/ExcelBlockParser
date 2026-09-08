import { Alert, Button, Drawer, Empty, List, Tag, Typography } from 'antd'
import { AimOutlined } from '@ant-design/icons'
import type { ParseDiagnostic } from '../types'
import { useI18n } from '../i18n'

interface DiagnosticsDrawerProps {
  open: boolean
  onClose: () => void
  parseDiagnostics: ParseDiagnostic[]
  validationErrors: string[]
  onFocus: (diagnostic: ParseDiagnostic) => void
  onFocusValidationItem: (kind: ValidationItemKind, name: string) => void
}

type ValidationItemKind = 'block' | 'region'

export function DiagnosticsDrawer({ open, onClose, parseDiagnostics, validationErrors, onFocus, onFocusValidationItem }: DiagnosticsDrawerProps) {
  const { t } = useI18n()
  const count = parseDiagnostics.length + validationErrors.length
  return <Drawer title={`${t('common.diagnostics')}${count ? ` (${count})` : ''}`} open={open} onClose={onClose} width={360} zIndex={1202} destroyOnClose>
    {count === 0 ? <Empty description={t('diagnostics.none')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
      {validationErrors.map((error) => <Alert key={error} type="error" showIcon message={<ValidationMessage error={error} t={t} onFocusItem={onFocusValidationItem} />} style={{ marginBottom: 8 }} />)}
      {parseDiagnostics.length > 0 && <List dataSource={parseDiagnostics} renderItem={(diagnostic) => <List.Item actions={diagnostic.blockId || diagnostic.regionId ? [<Button key="focus" size="small" type="text" icon={<AimOutlined />} onClick={() => onFocus(diagnostic)}>{t('common.locate')}</Button>] : []}>
        <List.Item.Meta
          title={<><Tag color={diagnostic.severity === 'error' ? 'error' : 'warning'}>{t(`diagnostics.code.${diagnostic.code}`)}</Tag>{diagnosticMessage(diagnostic, t)}</>}
          description={diagnostic.sheetName ? t('diagnostics.sheet', { sheet: diagnostic.sheetName }) : diagnostic.column ? t('diagnostics.column', { column: diagnostic.column, row: diagnostic.row != null ? diagnostic.row + 1 : '-' }) : undefined}
        />
      </List.Item>} />}
    </>}
  </Drawer>
}

function ValidationMessage({ error, t, onFocusItem }: {
  error: string
  t: (key: string, values?: Record<string, string | number>) => string
  onFocusItem: (kind: ValidationItemKind, name: string) => void
}) {
  const message = validationMessage(error, t)
  const target = validationTarget(error)
  if (!target) return message
  const index = message.indexOf(target.name)
  if (index < 0) return message
  return <>
    {message.slice(0, index)}
    <Typography.Link onClick={() => onFocusItem(target.kind, target.name)}>{target.name}</Typography.Link>
    {message.slice(index + target.name.length)}
  </>
}

function validationTarget(error: string): { kind: ValidationItemKind; name: string } | null {
  // A duplicate-name diagnostic represents more than one item, so there is no
  // single correct destination for an inline link.
  if (/^Duplicate (?:block|region) name:/.test(error)) return null

  const block = /^Invalid block name: "(.+)"$/.exec(error)
    ?? /^Block "(.+)" /.exec(error)
    ?? /^Invalid key in "(.+)":/.exec(error)
    ?? /^Column ".+" is outside block "(.+)" source range\.$/.exec(error)
    ?? /^Invalid downstream property in "(.+)":/.exec(error)
    ?? /^Invalid downstream property ".+" in "(.+)":/.exec(error)
    ?? /^Duplicate output key in "(.+)":/.exec(error)
  if (block) return { kind: 'block', name: block[1] }

  const region = /^Invalid region name: "(.+)"$/.exec(error)
    ?? /^Region "(.+)" /.exec(error)
  return region ? { kind: 'region', name: region[1] } : null
}

function diagnosticMessage(diagnostic: ParseDiagnostic, t: (key: string, values?: Record<string, string | number>) => string): string {
  switch (diagnostic.code) {
    case 'invalid-range': return t('diagnostics.message.invalidRange')
    case 'duplicate-key': return t('diagnostics.message.duplicateKey')
    case 'type-conversion': return t('diagnostics.message.typeConversion', { row: diagnostic.row != null ? diagnostic.row + 1 : '-', column: diagnostic.column ?? '-' })
    case 'sheet-missing': return t('diagnostics.message.sheetMissing')
    case 'unsupported-content': return t('diagnostics.message.unsupportedContent')
  }
}

function validationMessage(error: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const duplicateBlock = /^Duplicate block name: "(.+)"$/.exec(error)
  if (duplicateBlock) return t('diagnostics.validation.duplicateBlock', { name: duplicateBlock[1] })
  const duplicateRegion = /^Duplicate region name: "(.+)"$/.exec(error)
  if (duplicateRegion) return t('diagnostics.validation.duplicateRegion', { name: duplicateRegion[1] })
  const invalidBlock = /^Invalid block name: "(.+)"$/.exec(error)
  if (invalidBlock) return t('diagnostics.validation.invalidBlockName', { name: invalidBlock[1] })
  const invalidRegion = /^Invalid region name: "(.+)"$/.exec(error)
  if (invalidRegion) return t('diagnostics.validation.invalidRegionName', { name: invalidRegion[1] })
  const missingBlockSheet = /^Block "(.+)" requires a source sheet\.$/.exec(error)
  if (missingBlockSheet) return t('diagnostics.validation.blockMissingSheet', { name: missingBlockSheet[1] })
  const missingRegionWorkbook = /^Region "(.+)" has no available workbook\.$/.exec(error)
  if (missingRegionWorkbook) return t('diagnostics.validation.regionMissingWorkbook', { name: missingRegionWorkbook[1] })
  const missingRegionName = /^Region "(.+)" requires a name\.$/.exec(error)
  if (missingRegionName) return t('diagnostics.validation.regionMissingName', { id: missingRegionName[1] })
  const invalidRegionRange = /^Region "(.+)" has an invalid source range\.$/.exec(error)
  if (invalidRegionRange) return t('diagnostics.validation.invalidRegionRange', { name: invalidRegionRange[1] })
  const invalidKey = /^Invalid key in "(.+)": "(.+)"$/.exec(error)
  if (invalidKey) return t('diagnostics.validation.invalidKey', { block: invalidKey[1], key: invalidKey[2] })
  const columnOutsideRange = /^Column "(.+)" is outside block "(.+)" source range\.$/.exec(error)
  if (columnOutsideRange) return t('diagnostics.validation.columnOutsideRange', { key: columnOutsideRange[1], block: columnOutsideRange[2] })
  const unnamedProperty = /^Block "(.+)" has an unnamed downstream property\.$/.exec(error)
  if (unnamedProperty) return t('diagnostics.validation.unnamedProperty', { block: unnamedProperty[1] })
  const invalidProperty = /^Invalid downstream property in "(.+)": "(.+)"$/.exec(error)
  if (invalidProperty) return t('diagnostics.validation.invalidProperty', { block: invalidProperty[1], property: invalidProperty[2] })
  const invalidPropertyExpression = /^Invalid downstream property "(.+)" in "(.+)": (.+)$/.exec(error)
  if (invalidPropertyExpression) return t('diagnostics.validation.invalidPropertyExpression', { property: invalidPropertyExpression[1], block: invalidPropertyExpression[2], reason: localizeExpressionReason(invalidPropertyExpression[3], t) })
  const duplicateOutputKey = /^Duplicate output key in "(.+)": "(.+)"$/.exec(error)
  if (duplicateOutputKey) return t('diagnostics.validation.duplicateOutputKey', { block: duplicateOutputKey[1], key: duplicateOutputKey[2] })
  const filterDepth = /^Block "(.+)" row filter (.+) exceeds the maximum nesting depth of (\d+)\.$/.exec(error)
  if (filterDepth) return t('diagnostics.validation.filterDepth', { block: filterDepth[1], path: filterDepth[2], depth: filterDepth[3] })
  const emptyFilterGroup = /^Block "(.+)" row filter group (.+) is empty\.$/.exec(error)
  if (emptyFilterGroup) return t('diagnostics.validation.emptyFilterGroup', { block: emptyFilterGroup[1], path: emptyFilterGroup[2] })
  const unavailableFilterColumn = /^Block "(.+)" row filter (.+) references unavailable column "(.+)"\.$/.exec(error)
  if (unavailableFilterColumn) return t('diagnostics.validation.unavailableFilterColumn', { block: unavailableFilterColumn[1], path: unavailableFilterColumn[2], column: unavailableFilterColumn[3] })
  const filterValues = /^Block "(.+)" row filter (.+) requires one or more non-empty values\.$/.exec(error)
  if (filterValues) return t('diagnostics.validation.filterValues', { block: filterValues[1], path: filterValues[2] })
  const filterValue = /^Block "(.+)" row filter (.+) requires a value\.$/.exec(error)
  if (filterValue) return t('diagnostics.validation.filterValue', { block: filterValue[1], path: filterValue[2] })
  const invalidRegex = /^Block "(.+)" row filter (.+) has an invalid regular expression\.$/.exec(error)
  if (invalidRegex) return t('diagnostics.validation.invalidRegex', { block: invalidRegex[1], path: invalidRegex[2] })
  const missingKeyword = /^Region "(.+)" rule (\d+) requires a keyword\.$/.exec(error)
  if (missingKeyword) return t('diagnostics.validation.regionKeyword', { region: missingKeyword[1], rule: missingKeyword[2] })
  const invalidGap = /^Region "(.+)" rule (\d+) requires a positive integer minimum gap\.$/.exec(error)
  if (invalidGap) return t('diagnostics.validation.regionGap', { region: invalidGap[1], rule: invalidGap[2] })
  return error
}

function localizeExpressionReason(reason: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  return reason === 'invalid Python syntax' ? t('diagnostics.validation.invalidPythonSyntax') : reason
}
