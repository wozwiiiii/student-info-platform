/**
 * 指标埋点与数据看板（M5，对应 spec 第 6 节验证指标）
 * 口径唯一定义在 shared/domain/metrics.ts，后台看板与任何消费方共用
 */
import type { IsoDate, IsoDateTime } from './common'

/** 活跃流水（按 openId + 日期幂等去重，支撑周活统计） */
export interface ActivityLogRecord {
  id: string
  openId: string
  /** Asia/Shanghai 当天日期 YYYY-MM-DD */
  date: IsoDate
  at: IsoDateTime
}

/** 埋点事件流水（当前仅订阅消息回流打开） */
export interface EventLogRecord {
  id: string
  openId: string
  type: 'open_remind'
  /** 打开来源对应的信息条目 id（订阅消息 page 携带） */
  infoId?: string
  at: IsoDateTime
}

/** 数据看板快照（api-admin metrics.dashboard 返回） */
export interface MetricsSnapshot {
  /** 周活：近 7 天（含今天）不同 openId 数 */
  weeklyActiveUsers: number
  totalUsers: number
  /** 当下可触达订阅者：持有 quota>0 且未过期授权余量的不同 openId 数 */
  reachableSubscribers: number
  /** 订阅率 = reachableSubscribers / weeklyActiveUsers（分母 0 → null） */
  subscribeRate: number | null
  /** 提醒推送成功数（reminder_log.status='sent'） */
  reminderPushed: number
  /** 提醒打开数（event_log.type='open_remind'） */
  reminderOpens: number
  /** 打开率 = reminderOpens / reminderPushed（分母 0 → null） */
  openRate: number | null
  submissionsTotal: number
  /** 近 7 天（含今天）新增投稿 */
  submissions7d: number
  /** 纠错动作数（review_log.action='corrected'） */
  corrections: number
  /** 发布动作数（review_log.action='published'） */
  publishes: number
  /** 纠错率 = corrections / publishes（分母 0 → null） */
  correctionRate: number | null
  computedAt: IsoDateTime
}
