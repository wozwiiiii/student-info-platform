/** 展示层格式化（存储一律 ISO 8601，AGENT.md §3.3；展示统一 Asia/Shanghai） */
import { getDeadlineInstant } from '@shared/domain'
import type { DeadlineInfo, InfoCategory, InfoSubType, SourceType } from '@shared/types'

export const CATEGORY_LABELS: Record<InfoCategory, string> = {
  opportunity: '机会成长',
  scholarship: '奖助评优',
  academic: '教务通知',
  lecture: '讲座活动'
}

export const SUBTYPE_LABELS: Record<InfoSubType, string> = {
  competition: '竞赛',
  job_internship: '就业实习',
  postgrad: '保研',
  other: '其他'
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  wechat_mp: '公众号',
  official_site: '官网',
  user_submission: '投稿',
  manual: '人工录入'
}

/** 路线图节点学年/学期标签（A4） */
export const ROADMAP_YEAR_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: '大一',
  2: '大二',
  3: '大三',
  4: '大四'
}

export const ROADMAP_SEMESTER_LABELS: Record<1 | 2, string> = {
  1: '秋季学期',
  2: '春季学期'
}

/** ISO → Asia/Shanghai 展示（服务器时间戳多为 Z 结尾，统一 +8 换算） */
export function formatIsoToShanghai(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

/** 截止时间展示：date 精度显示日期；datetime 显示到分钟（按录入的 +08:00 时间） */
export function formatDeadline(deadline?: DeadlineInfo): string {
  if (!deadline) return ''
  if (deadline.precision === 'date') return deadline.date.slice(0, 10)
  if (deadline.date.endsWith('+08:00')) return deadline.date.slice(0, 16).replace('T', ' ')
  return formatIsoToShanghai(deadline.date)
}

/** 距截止的倒计时文案（A3 日历用）：今天截止 / 剩 N 天 / 已截止 */
export function formatCountdown(deadline?: DeadlineInfo, now: Date = new Date()): string {
  if (!deadline) return ''
  const ms = getDeadlineInstant(deadline).getTime() - now.getTime()
  if (ms <= 0) return '已截止'
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days <= 1 && new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    === new Date(getDeadlineInstant(deadline).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)) {
    return '今天截止'
  }
  return `剩 ${days} 天`
}
