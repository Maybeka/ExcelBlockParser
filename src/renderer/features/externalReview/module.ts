import type { ProjectFeatureModule } from '../core/projectFeature'

export const externalReviewFeatureModule: ProjectFeatureModule = {
  id: 'builtin.external-review',
  schemaVersion: 1,
  initialize: project => project,
  activateWorkbook: project => project,
  workbookLoaded: project => project,
  removeWorkbook: project => project,
  prepareForSave: project => project,
  validate: () => [],
  diagnosticFocus: () => null,
  execute: () => ({}),
}
