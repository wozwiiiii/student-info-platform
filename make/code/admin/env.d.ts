/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** api-admin 云函数 HTTP API 基址（不含末尾斜杠） */
  readonly VITE_API_BASE: string
}
