import '@univerjs/preset-sheets-core/lib/index.css'

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import type { AppLocale } from '../i18n'

export function setupUniver(container: HTMLElement, appLocale: AppLocale) {
  const locale = appLocale === 'zh-CN' ? LocaleType.ZH_CN : LocaleType.EN_US
  const { univerAPI } = createUniver({
    locale,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN, sheetsCoreEnUS),
      [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS, sheetsCoreZhCN),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        header: false,
        toolbar: false,
        footer: {
          sheetBar: true,
          statisticBar: false,
          addSheetButtonConfig: { show: false },
        },
        contextMenu: false,
      }),
    ],
  })

  return { univerAPI }
}
