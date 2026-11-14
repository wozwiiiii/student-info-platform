/** 用户与订阅服务（M3：C1/D0 微信授权登录 + A3 订阅授权记录） */
import type { SubscribeRecord, User, UserSubscribeState } from '@shared/types'
import { callApi, isCloudAvailable } from './cloud'

export interface LoginResult {
  user: User & { id: string }
  created: boolean
}

export interface SubscribeStatusResult {
  subscribeState: UserSubscribeState
  totalQuota: number
  records: SubscribeRecord[]
}

/** 静默登录：OPENID 幂等落 user 集合（无需用户点击授权按钮，D0） */
export function silentLogin(): Promise<LoginResult> {
  return callApi<LoginResult>('api-user', 'user.login')
}

/** 选填资料（学院/年级，为 V1 的 A7 过滤积累） */
export function updateProfile(payload: { college?: string; grade?: string }): Promise<{ openId: string }> {
  return callApi<{ openId: string }>('api-user', 'user.profile', payload)
}

/** requestSubscribeMessage 成功后记录授权余量（R11） */
export function recordSubscribe(payload: {
  templateId: string
  quota?: number
  expireAt?: string
}): Promise<{ id: string; quota: number }> {
  return callApi<{ id: string; quota: number }>('api-user', 'subscribe.record', payload)
}

export function getSubscribeStatus(): Promise<SubscribeStatusResult> {
  return callApi<SubscribeStatusResult>('api-user', 'subscribe.status')
}

let loginPromise: Promise<LoginResult> | null = null

/** 幂等登录（进程内只登录一次，失败可重试） */
export function ensureLogin(): Promise<LoginResult> {
  if (!isCloudAvailable()) {
    return Promise.reject(new Error('云开发不可用：请在微信小程序中使用'))
  }
  if (!loginPromise) {
    loginPromise = silentLogin().catch((e) => {
      loginPromise = null
      throw e
    })
  }
  return loginPromise
}
