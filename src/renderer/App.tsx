import { ConfigProvider } from 'antd'
import { UniverProvider } from './context/UniverContext'
import { WorkspaceApplication } from './WorkspaceApplication'

/** Application composition root. Durable workflows live behind coordinators. */
export function App() {
  return (
    <ConfigProvider theme={{ token: {
      colorPrimary: '#3390ec', colorInfo: '#3390ec', colorSuccess: '#39a883', colorWarning: '#e5a33e',
      colorBgLayout: '#e7eff5', colorBgContainer: '#ffffff', colorBorder: '#d9e4ec', colorText: '#263645',
      colorTextSecondary: '#7e8d9a', borderRadius: 8, borderRadiusSM: 6, controlHeight: 32, fontSize: 13,
    } }}>
      <UniverProvider>
        <WorkspaceApplication />
      </UniverProvider>
    </ConfigProvider>
  )
}
