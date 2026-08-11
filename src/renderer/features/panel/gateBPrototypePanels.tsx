import type { FeaturePanelContribution } from './FeaturePanelHost'

function FailingPanel(): never {
  throw new Error('Gate B render-isolation fixture')
}

export function gateBPrototypePanel(search: string): FeaturePanelContribution | null {
  if (!import.meta.env.DEV) return null
  const requested = new URLSearchParams(search).get('feature-panel-prototype')
  if (requested === 'render-failure') {
    return {
      id: 'builtin.failure-fixture',
      title: 'Failure fixture',
      ariaLabel: 'Feature failure fixture',
      render: () => <FailingPanel />,
    }
  }
  return null
}
