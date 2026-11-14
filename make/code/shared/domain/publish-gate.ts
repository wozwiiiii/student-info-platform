/**
 * 发布门禁（AGENT.md §4.3/§4.4 落地为代码校验）
 * - 不做无来源信息：sourceUrl 与 sourceChannel 至少一个
 * - 截止日期必须人工复核后才可发布（R12）
 */
import type { DeadlineInfo } from '../types'

export interface PublishCheckInput {
  sourceUrl: string
  sourceChannel: string
  deadline?: DeadlineInfo
  deadlineVerifiedByHuman: boolean
}

export type PublishCheckResult =
  | { ok: true }
  | { ok: false; reason: 'missing_source' | 'deadline_unverified' }

export function checkPublishable(input: PublishCheckInput): PublishCheckResult {
  if (!input.sourceUrl.trim() && !input.sourceChannel.trim()) {
    return { ok: false, reason: 'missing_source' }
  }
  if (input.deadline && !input.deadlineVerifiedByHuman) {
    return { ok: false, reason: 'deadline_unverified' }
  }
  return { ok: true }
}
