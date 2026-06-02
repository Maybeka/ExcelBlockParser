import '@univerjs/preset-sheets-core/index.css'

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'

export function setupUniver(container: HTMLElement) {
  const { univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN, sheetsCoreEnUS),
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
