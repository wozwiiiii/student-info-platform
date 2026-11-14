/** 信息读取服务（A1 信息流 / A2 分类频道，仅 published） */
import type { InfoCategory, Information } from '@shared/types'
import { callApi } from './cloud'

export interface InfoListResult {
  items: Information[]
  total: number
  page: number
  pageSize: number
}

export function listInfo(payload: {
  category?: InfoCategory
  page: number
  pageSize: number
}): Promise<InfoListResult> {
  return callApi<InfoListResult>('api-info', 'info.list', payload)
}

export interface DeadlineListResult {
  items: Information[]
  total: number
  withinDays: number
}

/** Deadline 日历（A3）：未来 N 天内截止的条目，按截止时刻升序 */
export function listDeadlines(withinDays = 30): Promise<DeadlineListResult> {
  return callApi<DeadlineListResult>('api-info', 'info.deadlines', { withinDays })
}
