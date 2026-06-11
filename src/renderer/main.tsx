import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import PreviewApp from './PreviewApp'
import './global.css'

function isPreviewMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('preview') === 'true') return true
  if (window.location.hash.startsWith('#/preview')) return true
  return false
}

const RootComponent = isPreviewMode() ? PreviewApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(<RootComponent />)
