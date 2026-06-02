/**
 * Font configuration for Univer spreadsheet rendering.
 *
 * DEFAULT_CELL_FONT — fallback for cells without an explicit font from Excel.
 * FORCE_DEFAULT_FONT — if true, ALL cells use DEFAULT_CELL_FONT (ignore Excel).
 *
 * WebView2 canvas cannot access system CJK fonts by name (e.g. "Microsoft YaHei").
 * Use "sans-serif" for reliable cross-platform rendering, or "Arial"/"Segoe UI" for Windows.
 */
export const DEFAULT_CELL_FONT = 'sans-serif'
export const FORCE_DEFAULT_FONT = false
