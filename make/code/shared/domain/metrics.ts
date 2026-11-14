/**
 * 指标口径唯一定义（M5，spec 第 6 节验证指标）
 * 【假设】以下 KPI 口径为工程侧预设，需产品在试点中确认：
 *  - 周活 = 近 7 天（含今天，Asia/Shanghai）不同 openId 的 activity_log 数
 *  - 订阅率 = 当下可触达订阅者（quota>0 未过期）/ 周活
 *  - 打开率 = 订阅消息回流打开数（event_log）/ 推送成功数（reminder_log sent）
 *  - 纠错率 = review_log 中 corrected 动作数 / published 动作数
 * 比率分母为 0 时返回 null（看板显示「—」），不返回 0 以免误导
 */

/** 原始计数（云函数聚合后传入，计算集中在本纯函数便于单测） */
export interface MetricsRawCounts {
  weeklyActiveUsers: number
  totalUsers: number
  reachableSubscribers: number
  reminderPushed: number
  reminderOpens: number
  submissionsTotal: number
  submissions7d: number
  corrections: number
  publishes: number
}

export interface MetricsSnapshotCore extends MetricsRawCounts {
  subscribeRate: number | null
  openRate: number | null
  correctionRate: number | null
}

/** 比率：分母为 0 → null；否则四舍五入到 4 位小数（0.1234） */
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 10000) / 10000
}

export function buildMetricsSnapshot(raw: MetricsRawCounts): MetricsSnapshotCore {
  return {
    ...raw,
    subscribeRate: safeRate(raw.reachableSubscribers, raw.weeklyActiveUsers),
    openRate: safeRate(raw.reminderOpens, raw.reminderPushed),
    correctionRate: safeRate(raw.corrections, raw.publishes)
  }
}
