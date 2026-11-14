/**
 * 云开发调用封装（AGENT.md §4.7 统一返回 {code, message, data}）
 * 客观事实：wx.cloud 仅在微信小程序环境存在；H5 预览无云开发能力，调用会得到明确错误而非伪造数据
 */
import type { ApiResult } from '@shared/types'

interface WxCloud {
  init(options?: { env?: string }): void
  callFunction(options: { name: string; data?: unknown }): Promise<{ result: unknown }>
}

interface WxGlobal {
  wx?: { cloud?: WxCloud }
}

let initialized = false

function getCloud(): WxCloud | null {
  return (globalThis as WxGlobal).wx?.cloud ?? null
}

export function isCloudAvailable(): boolean {
  return getCloud() !== null
}

export function initCloud(): void {
  const cloud = getCloud()
  if (!cloud || initialized) return
  cloud.init()
  initialized = true
}

export async function callApi<T>(fn: string, action: string, payload?: unknown): Promise<T> {
  const cloud = getCloud()
  if (!cloud) {
    throw new Error('云开发不可用：当前为 H5 预览或未连接微信云开发')
  }
  const res = await cloud.callFunction({ name: fn, data: { action, payload } })
  const result = res.result as ApiResult<T> | undefined
  if (!result || result.code !== 0) {
    throw new Error(result?.message ?? '云函数返回异常')
  }
  return result.data as T
}
