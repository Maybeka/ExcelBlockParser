import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { UniverProvider } from './context/UniverContext'
import { WorkspaceApplication } from './WorkspaceApplication'
import { I18nProvider, useI18n } from './i18n'

/** Application composition root. Durable workflows live behind coordinators. */
export function App() {
  return <I18nProvider><ApplicationShell /></I18nProvider>
}

function ApplicationShell() {
  const { locale } = useI18n()
  return (
    <ConfigProvider locale={locale === 'zh-CN' ? zhCN : enUS} theme={{ token: {
      colorPrimary: '#415f91', colorInfo: '#415f91', colorSuccess: '#386a4a', colorWarning: '#825500', colorError: '#ba1a1a',
      colorBgLayout: '#f9f9ff', colorBgContainer: '#ffffff', colorBgElevated: '#ffffff', colorBorder: '#74777f', colorText: '#1a1b20',
      colorTextSecondary: '#5a5d66', borderRadius: 12, borderRadiusSM: 8, controlHeight: 34, controlHeightSM: 28, fontSize: 13,
    }, components: {
      Button: { borderRadius: 18, borderRadiusSM: 14, primaryShadow: 'none', defaultShadow: 'none' },
      Input: { activeShadow: '0 0 0 1px #415f91' },
      Select: { optionSelectedBg: '#dbe2f9' },
      Modal: { borderRadiusLG: 20 },
      Drawer: { colorBgElevated: '#f9f9ff' },
    } }}>
      <UniverProvider>
        <WorkspaceApplication />
      </UniverProvider>
    </ConfigProvider>
  )
}
