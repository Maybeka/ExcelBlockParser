import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { drawSelection, EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const projectPythonHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: '#8839ef', fontWeight: '600' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#1e66f5', fontWeight: '600' },
  { tag: [tags.className, tags.typeName], color: '#179299', fontWeight: '600' },
  { tag: [tags.propertyName, tags.attributeName], color: '#7287fd' },
  { tag: [tags.string, tags.docString, tags.character], color: '#40a02b' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#fe640b' },
  { tag: [tags.self, tags.standard(tags.variableName)], color: '#209fb5', fontStyle: 'italic' },
  { tag: tags.comment, color: '#9ca0b0', fontStyle: 'italic' },
  { tag: [tags.operator, tags.operatorKeyword], color: '#179299' },
  { tag: [tags.punctuation, tags.bracket], color: '#6c6f85' },
  { tag: tags.escape, color: '#e64553', fontWeight: '600' },
  { tag: tags.invalid, color: '#d20f39', textDecoration: 'underline wavy' },
])

export const projectPythonEditorTheme: Extension = [
  drawSelection(),
  EditorView.theme({
    '&': {
      backgroundColor: '#eff1f5',
      color: '#4c4f69',
    },
    '.cm-content': {
      caretColor: '#1e66f5',
      padding: '10px 0 14px',
    },
    '.cm-line': {
      padding: '0 10px',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#1e66f5',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#7aa2f7 !important',
      color: '#ffffff !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: '#1e66f5 !important',
    },
    '.cm-activeLine': {
      backgroundColor: '#e6e9ef',
    },
    '.cm-gutters': {
      backgroundColor: '#e6e9ef',
      borderRight: '1px solid #ccd0da',
      color: '#8c8fa1',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#dce0e8',
      color: '#1e66f5',
      fontWeight: '600',
    },
    '.cm-foldGutter span': {
      color: '#7c7f93',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#ccd0da',
      color: '#179299 !important',
      outline: '1px solid #8c8fa1',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: '#ccd0da',
      color: '#d20f39 !important',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#ccd0da',
      border: '0',
      color: '#5c5f77',
      padding: '0 5px',
    },
  }),
  syntaxHighlighting(projectPythonHighlightStyle),
]
