import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-drawing/lib/index.css'
import '@univerjs/sheets-filter-ui/lib/index.css'

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import { UniverSheetsDrawingPreset } from '@univerjs/preset-sheets-drawing'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import sheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US'
import sheetsFilterZhCN from '@univerjs/preset-sheets-filter/locales/zh-CN'
import type { AppLocale } from '../i18n'

export function setupUniver(container: HTMLElement, appLocale: AppLocale) {
  const locale = appLocale === 'zh-CN' ? LocaleType.ZH_CN : LocaleType.EN_US
  const { univerAPI } = createUniver({
    locale,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN, sheetsFilterZhCN, sheetsCoreEnUS, sheetsFilterEnUS),
      [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS, sheetsFilterEnUS, sheetsCoreZhCN, sheetsFilterZhCN),
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
      UniverSheetsDrawingPreset(),
      UniverSheetsFilterPreset(),
    ],
  })

  return { univerAPI }
}
