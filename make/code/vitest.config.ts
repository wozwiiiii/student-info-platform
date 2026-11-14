import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // wx-server-sdk 仅在云开发环境存在，测试期指向内存桩
      'wx-server-sdk': path.resolve(__dirname, 'cloudfunctions/__mocks__/wx-server-sdk.ts'),
      // miniprogram 用 @shared 别名引用共享层（见 miniprogram/tsconfig.json paths），测试期需同样解析
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  test: {
    // miniprogram 仅收录纯函数单测（utils/），页面与组件按 AGENT.md §4.8 不强制 E2E
    include: ['shared/**/*.test.ts', 'cloudfunctions/**/*.test.ts', 'miniprogram/src/utils/**/*.test.ts'],
    environment: 'node'
  }
})
