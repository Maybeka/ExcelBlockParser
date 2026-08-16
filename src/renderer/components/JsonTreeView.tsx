import ReactJson, { type ReactJsonViewProps } from '@microlink/react-json-view'

const CATPPUCCIN_LATTE_JSON_THEME = {
  base00: '#eff1f5', base01: '#e6e9ef', base02: '#ccd0da', base03: '#4c4f69',
  // react-json-view uses base06 for its opening delimiters. Keep all JSON
  // structural punctuation on the same high-contrast foreground color.
  base04: '#5c5f77', base05: '#4c4f69', base06: '#4c4f69', base07: '#4c4f69',
  base08: '#d20f39', base09: '#fe640b', base0A: '#df8e1d', base0B: '#40a02b',
  base0C: '#179299', base0D: '#1e66f5', base0E: '#8839ef', base0F: '#4c4f69',
}

export interface JsonTreeViewProps {
  value: object
  className?: string
  collapsed?: boolean | number
  shouldCollapse?: Exclude<ReactJsonViewProps['shouldCollapse'], false>
}

export function JsonTreeView({ value, className = '', collapsed = false, shouldCollapse }: JsonTreeViewProps) {
  return (
    <div className={`json-tree-view ${className}`}>
      <ReactJson
        src={value}
        theme={CATPPUCCIN_LATTE_JSON_THEME}
        collapsed={collapsed}
        shouldCollapse={shouldCollapse || false}
        displayDataTypes
        displayObjectSize
        enableClipboard={false}
        name={false}
        quotesOnKeys={false}
        style={{ padding: 14, fontFamily: 'var(--font-code)', fontSize: 13, lineHeight: 1.45 }}
      />
    </div>
  )
}
