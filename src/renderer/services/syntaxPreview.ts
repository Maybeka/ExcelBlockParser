export type PreviewLanguage = 'json' | 'python' | 'system-verilog'

type Highlighter = {
  codeToHtml: (source: string, options: { lang: PreviewLanguage; theme: 'catppuccin-latte' }) => Promise<string>
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('@shikijs/core'),
      import('@shikijs/engine-javascript'),
      import('@shikijs/langs/python'),
      import('@shikijs/langs/json'),
      import('@shikijs/langs/system-verilog'),
      import('@shikijs/themes/catppuccin-latte'),
    ]).then(async ([core, engine, python, json, systemVerilog, theme]) => core.createHighlighterCore({
      engine: engine.createJavaScriptRegexEngine(),
      langs: [python.default, json.default, systemVerilog.default],
      themes: [theme.default],
    }))
  }
  return highlighterPromise
}

export function highlightPreview(source: string, language: PreviewLanguage): Promise<string> {
  return getHighlighter().then(highlighter => highlighter.codeToHtml(source, { lang: language, theme: 'catppuccin-latte' }))
}
