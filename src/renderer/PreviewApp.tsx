import { ConfigProvider } from 'antd'
import { PreviewWindow, type PreviewDataSource } from './components/PreviewWindow'
import { getBridge } from './services/bridge'
import type { PreviewData } from './types'

const previewDataSource: PreviewDataSource = {
  getData: async blockId => await getBridge().getPreviewData(blockId) as PreviewData | undefined,
  onReload: callback => getBridge().onPreviewReload(callback),
}

export default function PreviewApp() {
  return (
    <ConfigProvider>
      <PreviewWindow dataSource={previewDataSource} />
    </ConfigProvider>
  )
}
