import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Button } from 'antd'

export interface FeaturePanelContribution {
  id: string
  title: string
  summary?: string
  ariaLabel: string
  render(): ReactNode
}

interface FeaturePanelHostProps {
  panel: FeaturePanelContribution
  onRenderError?: (featureId: string, error: Error) => void
}

interface BoundaryProps {
  featureId: string
  onError?: (featureId: string, error: Error) => void
  children: ReactNode
}

interface BoundaryState { error: Error | null; retryKey: number }

class FeaturePanelErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError?.(this.props.featureId, error)
  }

  private retry = () => this.setState(state => ({ error: null, retryKey: state.retryKey + 1 }))

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="feature-panel-error" role="alert" data-testid="feature-panel-error">
          <Alert
            type="error"
            showIcon
            message="This feature panel could not be displayed"
            description={this.state.error.message}
          />
          <Button onClick={this.retry}>Retry panel</Button>
        </div>
      )
    }
    return <div key={this.state.retryKey} className="feature-panel-view">{this.props.children}</div>
  }
}

function PanelRenderer({ render }: { render: () => ReactNode }) {
  return <>{render()}</>
}

/** Host-owned mount point. Feature content cannot replace the shell boundary. */
export function FeaturePanelHost({ panel, onRenderError }: FeaturePanelHostProps) {
  return (
    <aside className="inspector-panel feature-panel-host" aria-label={panel.ariaLabel} data-feature-id={panel.id}>
      <header className="panel-heading inspector-heading">
        <div><strong>{panel.title}</strong></div>
        {panel.summary && <span>{panel.summary}</span>}
      </header>
      <div className="feature-panel-scroll" tabIndex={0} aria-label={`${panel.title} content`}>
        <FeaturePanelErrorBoundary key={panel.id} featureId={panel.id} onError={onRenderError}>
          <PanelRenderer render={panel.render} />
        </FeaturePanelErrorBoundary>
      </div>
    </aside>
  )
}
