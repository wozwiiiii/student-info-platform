/**
 * shared/domain/ai-extract 单测（整改记录 SN-38：AI 结果校验从 job-ai-extract 收口为纯函数）
 * 覆盖：置信度 → 审核状态分流、置信度归一、AI 提取结果校验。
 * 核心不变式：AI 输出永不直接产出 published（AGENT.md §4.3 / R12）。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_LOW_CONFIDENCE_THRESHOLD,
  isValidAiExtraction,
  normalizeConfidence,
  resolveStatusFromConfidence
} from '../ai-extract'

describe('resolveStatusFromConfidence', () => {
  it('置信度 >= 0.7 → pending_review', () => {
    expect(AI_LOW_CONFIDENCE_THRESHOLD).toBe(0.7)
    expect(resolveStatusFromConfidence(0.7)).toBe('pending_review')
    expect(resolveStatusFromConfidence(0.9)).toBe('pending_review')
    expect(resolveStatusFromConfidence(1)).toBe('pending_review')
  })

  it('置信度 < 0.7 → low_confidence（强制人工）', () => {
    expect(resolveStatusFromConfidence(0.69)).toBe('low_confidence')
    expect(resolveStatusFromConfidence(0)).toBe('low_confidence')
  })

  it('两种分支都不产出 published（AI 永不直发）', () => {
    for (const c of [0, 0.3, 0.69, 0.7, 0.85, 1]) {
      expect(resolveStatusFromConfidence(c)).not.toBe('published')
    }
  })
})

describe('normalizeConfidence', () => {
  it('合法值原样返回', () => {
    expect(normalizeConfidence(0.5)).toBe(0.5)
    expect(normalizeConfidence(0)).toBe(0)
    expect(normalizeConfidence(1)).toBe(1)
  })

  it('NaN / 非数值归一为 0（最低置信度 → 强制人工）', () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0)
    expect(normalizeConfidence('0.9')).toBe(0)
    expect(normalizeConfidence(undefined)).toBe(0)
  })

  it('越界值归一到 [0,1]', () => {
    expect(normalizeConfidence(-0.2)).toBe(0)
    expect(normalizeConfidence(1.5)).toBe(1)
  })
})

describe('isValidAiExtraction', () => {
  it('confidence 须为 [0,1] 内的有限数', () => {
    expect(isValidAiExtraction({ confidence: 0 })).toBe(true)
    expect(isValidAiExtraction({ confidence: 0.5 })).toBe(true)
    expect(isValidAiExtraction({ confidence: 1 })).toBe(true)
    expect(isValidAiExtraction({ confidence: -0.1 })).toBe(false)
    expect(isValidAiExtraction({ confidence: 1.2 })).toBe(false)
    expect(isValidAiExtraction({ confidence: Number.NaN })).toBe(false)
    expect(isValidAiExtraction({ confidence: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidAiExtraction({ confidence: '0.5' })).toBe(false)
    expect(isValidAiExtraction({})).toBe(false)
    expect(isValidAiExtraction(null)).toBe(false)
    expect(isValidAiExtraction('x')).toBe(false)
  })
})
