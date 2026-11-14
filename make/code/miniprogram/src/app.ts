import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'

import { initCloud, isCloudAvailable } from './services/cloud'
import { ensureLogin } from './services/user'
import { trackActivity } from './services/track'
import './app.scss'

function App({ children }: PropsWithChildren<unknown>) {
  useLaunch(() => {
    // wx.cloud 仅微信小程序环境存在（H5 预览跳过）
    initCloud()
    // C1/D0 静默登录：OPENID 幂等落库，失败不阻塞启动
    if (isCloudAvailable()) {
      ensureLogin().catch(() => {})
      // M5 周活埋点：每日一次幂等，失败静默
      trackActivity()
    }
  })

  return children
}

export default App
