import { ConfigProvider } from 'antd'
import { PreviewWindow } from './components/PreviewWindow'

export default function PreviewApp() {
  return (
    <ConfigProvider>
      <PreviewWindow />
    </ConfigProvider>
  )
}
