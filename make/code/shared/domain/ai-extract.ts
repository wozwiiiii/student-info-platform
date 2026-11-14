/**
 * AI 结构化结果的校验与状态分流（AGENT.md §4.8 点名的「AI 结果校验」纯函数）
 *
 * 【整改记录 SN-38】此前 confidence → reviewStatus 的分流内联在
 * job-ai-extract/src/index.ts，既无法单测，也不满足 §3.3「审核状态机收敛于 shared/domain」。
 * 现收口为纯函数，云函数只负责调用。
 */
import type { AiExtraction, ReviewStatus } from '../types'

/** AI 低置信度阈值（低于此值强制转人工，AGENT.md §4.3 / R12） */
export const AI_LOW_CONFIDENCE_THRESHOLD = 0.7

/**
 * 依据置信度决定 AI 提取后的目标状态（AGENT.md §4.3 / R12）：
 *  - confidence ≥ 阈值 → pending_review（仍需人工审核，AI 永不直发）
 *  - confidence < 阈值 → low_confidence（强制人工）
 * 无论哪条路径都不产生 published，这是「AI 输出永不直接发布」的代码保证。
 */
export function resolveStatusFromConfidence(confidence: number): 'pending_review' | 'low_confidence' {
  return confidence >= AI_LOW_CONFIDENCE_THRESHOLD ? 'pending_review' : 'low_confidence'
}

/** 该状态是否由 AI 流程产出（用于区分人工动作与 AI 动作，写 review_log.operator） */
export function isAiDerivedStatus(status: ReviewStatus): boolean {
  return status === 'ai_extracted' || status === 'low_confidence' || status === 'pending_review'
}

/** AI 提取结果校验（§4.8：confidence 必须在 [0,1]，结构必须完整） */
export function isValidAiExtraction(value: unknown): value is AiExtraction {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<AiExtraction>
  return typeof v.confidence === 'number' && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1
}

/** 置信度归一到 [0,1]，非法值返回 0（等同最低置信度 → 强制人工，宁可多审不可漏审） */
export function normalizeConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
