import { BuiltInFeatureRegistry } from './core/projectFeature'
import { extractionFeatureModule } from './extraction/module'
import { regionFeatureModule } from './regions/module'
import { externalReviewFeatureModule } from './externalReview/module'
import { WorkspaceFeaturePanelRegistry, type WorkspaceFeaturePanelProvider } from './panel/workspacePanel'
import { extractionPanelProvider } from './extraction/panel'
import { regionPanelProvider } from './regions/panel'
import { externalReviewPanelProvider } from './externalReview/panel'

const registrations: ReadonlyArray<{
  project: typeof extractionFeatureModule
  panel: WorkspaceFeaturePanelProvider
}> = [
  { project: extractionFeatureModule, panel: extractionPanelProvider },
  { project: regionFeatureModule, panel: regionPanelProvider },
  { project: externalReviewFeatureModule, panel: externalReviewPanelProvider },
]

export const builtInFeatureRegistry = new BuiltInFeatureRegistry(registrations.map(registration => registration.project))
export const builtInFeaturePanelRegistry = new WorkspaceFeaturePanelRegistry(registrations.map(registration => registration.panel))
