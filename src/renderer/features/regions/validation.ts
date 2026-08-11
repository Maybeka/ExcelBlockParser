import type { ProjectConfig, RegionConfig } from '../../types'
import { isValidVariableName } from '../extraction/validation'

export interface RegionValidationIssue { regionId: string; workbookId: string | null; message: string }

export function validateRegions(project: ProjectConfig): string[] {
  return regionValidationIssues(project).map(issue => issue.message)
}

export function regionValidationIssues(project: ProjectConfig): RegionValidationIssue[] {
  const issues: RegionValidationIssue[] = []
  const workbookIds = new Set(project.workbooks.map(workbook => workbook.id))
  const labels = new Map<string, number>()
  const report = (region: RegionConfig, message: string) => issues.push({ regionId: region.id, workbookId: region.workbookId ?? null, message })

  for (const region of project.regions) {
    const label = region.label.trim()
    const owner = region.workbookId ?? ''
    if (!owner || !workbookIds.has(owner)) report(region, `Region "${label || region.id}" has no available workbook.`)
    if (!label) report(region, `Region "${region.id}" requires a name.`)
    else if (!isValidVariableName(label)) report(region, `Invalid region name: "${region.label}"`)
    const scopedLabel = `${owner}\u0000${label}`
    labels.set(scopedLabel, (labels.get(scopedLabel) ?? 0) + 1)

    if (region.range && (!region.activeSheet || !validRange(region))) {
      report(region, `Region "${label || region.id}" has an invalid source range.`)
    }
    region.splitRules.forEach((rule, index) => {
      if (rule.type === 'keyword' && !rule.keyword?.trim()) {
        report(region, `Region "${label || region.id}" rule ${index + 1} requires a keyword.`)
      }
      if (rule.minGap !== undefined && (!Number.isInteger(rule.minGap) || rule.minGap < 1)) {
        report(region, `Region "${label || region.id}" rule ${index + 1} requires a positive integer minimum gap.`)
      }
    })
  }

  labels.forEach((count, key) => {
    const separator = key.indexOf('\u0000')
    const owner = key.slice(0, separator)
    const label = key.slice(separator + 1)
    if (!label || count <= 1) return
    project.regions.filter(region => (region.workbookId ?? '') === owner && region.label.trim() === label).forEach(region => report(region, `Duplicate region name: "${label}"`))
  })
  return issues
}

function validRange(region: RegionConfig): boolean {
  const range = region.range!
  return Number.isInteger(range.startRow) && Number.isInteger(range.startCol)
    && Number.isInteger(range.endRow) && Number.isInteger(range.endCol)
    && range.startRow >= 0 && range.startCol >= 0
    && range.endRow >= range.startRow && range.endCol >= range.startCol
    && Boolean(range.a1Notation)
}
