/**
 * 审核状态机（AGENT.md §3.3，单一实现，禁止散落 if-else）
 *
 * collected → ai_extracted → pending_review → published → archived/expired
 * ai_extracted → low_confidence（AI 低置信度强制转人工）
 * 任意态 → rejected / corrected（纠错与驳回留痕走 review_log）
 * corrected → pending_review（纠错后重审）
 */
import type { ReviewStatus } from '../types'

const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  collected: ['ai_extracted', 'pending_review'],
  ai_extracted: ['pending_review', 'low_confidence'],
  low_confidence: ['pending_review'],
  pending_review: ['published', 'rejected'],
  published: ['archived', 'expired', 'corrected'],
  archived: ['pending_review'],
  expired: ['pending_review'],
  rejected: ['pending_review'],
  corrected: ['pending_review']
}

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  if (from === to) return false
  // 任意态可驳回 / 纠错（spec 运营机制：错误快速纠错通道 R12）
  if (to === 'rejected' || to === 'corrected') return true
  return TRANSITIONS[from].includes(to)
}

/** 带校验的状态迁移：非法迁移抛错，调用方无需重复判断 */
export function expectTransition(from: ReviewStatus, to: ReviewStatus): ReviewStatus {
  if (!canTransition(from, to)) {
    throw new Error(`非法审核状态迁移: ${from} → ${to}`)
  }
  return to
}

// AI 低置信度阈值 AI_LOW_CONFIDENCE_THRESHOLD 移至 ./ai-extract（SN-38：AI 结果校验收口）
