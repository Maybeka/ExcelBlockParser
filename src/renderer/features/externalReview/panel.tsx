import type { WorkspaceFeaturePanelProvider } from '../panel/workspacePanel'
import { ExternalResultReviewPanel } from './ExternalResultReviewPanel'
import { createExternalCandidateReviewCapability } from './candidateReview'
import { serializeProject } from '../../services/serializer'

export const externalReviewPanelProvider: WorkspaceFeaturePanelProvider = {
  featureId: 'builtin.external-review',
  isActive: () => false,
  contribute(context) {
    const fixture = createExternalCandidateReviewCapability(context.project, context.parseResult)
      .review('candidate-result.json', serializeProject(context.project, context.parseResult))
    return {
      id: this.featureId,
      title: 'External result review',
      summary: `${fixture.differences.length} differences`,
      ariaLabel: 'External result review inspector',
      render: () => <ExternalResultReviewPanel fixture={fixture} />,
    }
  },
}
