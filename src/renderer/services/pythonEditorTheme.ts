import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const projectPythonHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: '#9b2f69', fontWeight: '600' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#146da0', fontWeight: '600' },
  { tag: [tags.className, tags.typeName], color: '#087d83', fontWeight: '600' },
  { tag: [tags.propertyName, tags.attributeName], color: '#7651a3' },
  { tag: [tags.string, tags.docString, tags.character], color: '#2d7a4d' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#ad5b12' },
  { tag: [tags.self, tags.standard(tags.variableName)], color: '#2675a8', fontStyle: 'italic' },
  { tag: tags.comment, color: '#778793', fontStyle: 'italic' },
  { tag: [tags.operator, tags.operatorKeyword], color: '#536a7a' },
  { tag: [tags.punctuation, tags.bracket], color: '#71808d' },
  { tag: tags.escape, color: '#b54c32', fontWeight: '600' },
  { tag: tags.invalid, color: '#c33f4a', textDecoration: 'underline wavy' },
])

export const projectPythonEditorTheme: Extension = [
  EditorView.theme({
    '&': {
      backgroundColor: '#fbfcfe',
      color: '#26394a',
    },
    '.cm-content': {
      caretColor: '#2385d5',
      padding: '10px 0 14px',
    },
    '.cm-line': {
      padding: '0 10px',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#2385d5',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: '#cfe9fb !important',
    },
    '.cm-activeLine': {
      backgroundColor: '#eef7fd',
    },
    '.cm-gutters': {
      backgroundColor: '#f3f7fa',
      borderRight: '1px solid #e1e9ef',
      color: '#92a0ac',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#e3f1fb',
      color: '#247fc4',
      fontWeight: '600',
    },
    '.cm-foldGutter span': {
      color: '#8193a1',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#d9f0e6',
      color: '#176e4a !important',
      outline: '1px solid #9fd3bb',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: '#fde6e8',
      color: '#b73744 !important',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#e8f0f5',
      border: '0',
      color: '#647786',
      padding: '0 5px',
    },
  }),
  syntaxHighlighting(projectPythonHighlightStyle),
]
