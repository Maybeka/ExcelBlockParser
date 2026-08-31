import { describe, expect, it } from 'vitest'
import { translate, resolveAppLocale } from '../i18n'

describe('interface translations', () => {
  it('provides localized workspace copy and interpolates values', () => {
    expect(translate('en-US', 'project.open')).toBe('Open Project')
    expect(translate('zh-CN', 'project.open')).toBe('打开项目')
    expect(translate('zh-CN', 'extract.blocksRegions', { blocks: 2, regions: 1 })).toBe('2 个数据块 · 1 个区域')
  })

  it('falls back to English for a locale-specific missing key', () => {
    expect(translate('zh-CN', 'not.a.translation')).toBe('not.a.translation')
  })

  it('defaults to English when no saved locale or language is available', () => {
    expect(resolveAppLocale(null, undefined)).toBe('en-US')
    expect(resolveAppLocale(null, '')).toBe('en-US')
    expect(resolveAppLocale('zh-CN', undefined)).toBe('zh-CN')
  })
})
