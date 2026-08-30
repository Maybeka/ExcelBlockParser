import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { PreviewWindow, type PreviewDataSource } from './components/PreviewWindow'
import { getBridge } from './services/bridge'
import type { PreviewData } from './types'
import { I18nProvider, useI18n } from './i18n'

const previewDataSource: PreviewDataSource = {
  getData: async blockId => await getBridge().getPreviewData(blockId) as PreviewData | undefined,
  onReload: callback => getBridge().onPreviewReload(callback),
}

export default function PreviewApp() {
  return <I18nProvider><PreviewApplication /></I18nProvider>
}

function PreviewApplication() {
  const { locale } = useI18n()
  return (
    <ConfigProvider locale={locale === 'zh-CN' ? zhCN : enUS}>
      <PreviewWindow dataSource={previewDataSource} />
    </ConfigProvider>
  )
}
