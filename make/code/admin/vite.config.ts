import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// shared/ 为三方共用层（小程序 / 云函数 / 后台），禁止复制字段定义，一律走 alias 引用
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url))
    }
  },
  server: {
    fs: {
      // 允许访问上级目录（读取 ../shared 源码）
      allow: [fileURLToPath(new URL('..', import.meta.url))]
    }
  }
})
