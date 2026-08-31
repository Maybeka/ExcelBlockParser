import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { Alert, Button, Tooltip } from 'antd'
import { MenuFoldOutlined } from '@ant-design/icons'
import { useI18n } from '../../i18n'

export interface FeaturePanelContribution {
  id: string
  title: string
  summary?: string
  ariaLabel: string
  headerActions?: ReactNode | ((target: HTMLElement | null) => ReactNode)
  render(headerActionsTarget?: HTMLElement | null): ReactNode
}

interface FeaturePanelHostProps {
  panels: readonly FeaturePanelContribution[]
  onRenderError?: (featureId: string, error: Error) => void
  onCollapse?: () => void
}

interface BoundaryProps {
  featureId: string
  onError?: (featureId: string, error: Error) => void
  children: ReactNode
}

interface BoundaryState { error: Error | null; retryKey: number }

function FeaturePanelError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="feature-panel-error" role="alert" data-testid="feature-panel-error">
      <Alert type="error" showIcon message={t('panel.unavailable')} description={error.message} />
      <Button onClick={onRetry}>{t('panel.retry')}</Button>
    </div>
  )
}

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
      return <FeaturePanelError error={this.state.error} onRetry={this.retry} />
    }
    return <div key={this.state.retryKey} className="feature-panel-view">{this.props.children}</div>
  }
}

function PanelRenderer({ render }: { render: () => ReactNode }) {
  return <>{render()}</>
}

function FeaturePanelSection({ panel, onRenderError, onCollapse }: { panel: FeaturePanelContribution; onRenderError?: (featureId: string, error: Error) => void; onCollapse?: () => void }) {
  const { t } = useI18n()
  const [headerActionsTarget, setHeaderActionsTarget] = useState<HTMLElement | null>(null)
  const actions = typeof panel.headerActions === 'function'
    ? panel.headerActions(headerActionsTarget)
    : panel.headerActions
  return (
    <section className="feature-panel-section" aria-label={panel.ariaLabel} data-feature-id={panel.id}>
      <header className="panel-heading inspector-heading inspector-heading-stacked">
        <div className="panel-heading-title"><strong>{panel.title}</strong>{panel.summary && <span>{panel.summary}</span>}</div>
        <div ref={setHeaderActionsTarget} className="panel-heading-actions">
          {actions}
          {onCollapse && <Tooltip title={t('app.hideInspector')}><Button aria-label={t('app.hideInspector')} size="small" type="text" icon={<MenuFoldOutlined />} onClick={onCollapse} /></Tooltip>}
        </div>
      </header>
      <div className="feature-panel-scroll" tabIndex={0} aria-label={`${panel.title} content`}>
        <FeaturePanelErrorBoundary featureId={panel.id} onError={onRenderError}>
          <PanelRenderer render={() => panel.render(headerActionsTarget)} />
        </FeaturePanelErrorBoundary>
      </div>
    </section>
  )
}

/** Host-owned mount point. Feature content cannot replace shell-owned section boundaries. */
export function FeaturePanelHost({ panels, onRenderError, onCollapse }: FeaturePanelHostProps) {
  const singlePanel = panels.length === 1 ? panels[0] : null
  return (
    <aside
      className={`inspector-panel feature-panel-host feature-panel-host-${Math.max(1, panels.length)}`}
      aria-label={singlePanel?.ariaLabel ?? 'Workspace configuration'}
      {...(singlePanel ? { 'data-feature-id': singlePanel.id } : {})}
    >
      {panels.map((panel, index) => <FeaturePanelSection key={panel.id} panel={panel} onRenderError={onRenderError} onCollapse={index === 0 ? onCollapse : undefined} />)}
    </aside>
  )
}
