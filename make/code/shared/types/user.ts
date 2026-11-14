/**
 * 用户与订阅消息（M3：C1/D0 微信授权登录 + A3 提醒订阅，AGENT.md §3.3）
 * 客观事实：微信订阅消息为一次性授权 → subscribe_record 记录授权余量（R11）
 */
import type { IsoDateTime } from './common'

/** 用户订阅状态（由 subscribe_record 余量派生，写入授权记录时同步） */
export type UserSubscribeState = 'none' | 'active'

/** 用户（college/grade 选填，为 V1 的 A7 过滤积累，不阻塞 M3 主链路） */
export interface User {
  openId: string
  college?: string
  grade?: string
  subscribeState: UserSubscribeState
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** 订阅消息授权记录（R11：quota = 剩余可推送次数，每次成功推送消耗 1） */
export interface SubscribeRecord {
  id: string
  openId: string
  templateId: string
  /** 授权余量（一次性授权 = 1） */
  quota: number
  subscribedAt: IsoDateTime
  /** 余量失效时间（可选；微信授权默认长期有效时留空） */
  expireAt?: IsoDateTime
  /** 最近一次消耗时间 */
  usedAt?: IsoDateTime
}

/** 推送失败留痕（R11：推送失败不静默，进后台看板） */
export interface PushFailRecord {
  id: string
  openId?: string
  infoId: string
  templateId: string
  reason: string
  at: IsoDateTime
}

/** 提醒推送流水（幂等去重键：infoId + remindAt + openId） */
export interface ReminderLogRecord {
  id: string
  infoId: string
  remindAt: IsoDateTime
  openId: string
  status: 'sent' | 'failed'
  at: IsoDateTime
}
