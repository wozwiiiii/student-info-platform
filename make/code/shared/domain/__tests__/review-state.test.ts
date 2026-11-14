import { describe, expect, it } from 'vitest'
import { canTransition, expectTransition } from '../review-state'

describe('审核状态机', () => {
  it('主链路：collected → ai_extracted → pending_review → published → archived', () => {
    expect(canTransition('collected', 'ai_extracted')).toBe(true)
    expect(canTransition('ai_extracted', 'pending_review')).toBe(true)
    expect(canTransition('pending_review', 'published')).toBe(true)
    expect(canTransition('published', 'archived')).toBe(true)
  })

  it('AI 低置信度强制转人工', () => {
    expect(canTransition('ai_extracted', 'low_confidence')).toBe(true)
    expect(canTransition('low_confidence', 'pending_review')).toBe(true)
    expect(canTransition('low_confidence', 'published')).toBe(false)
  })

  it('任意态可 rejected / corrected，corrected 后回重审', () => {
    expect(canTransition('published', 'rejected')).toBe(true)
    expect(canTransition('collected', 'corrected')).toBe(true)
    expect(canTransition('corrected', 'pending_review')).toBe(true)
  })

  it('禁止跳跃发布与自身迁移', () => {
    expect(canTransition('collected', 'published')).toBe(false)
    expect(canTransition('published', 'published')).toBe(false)
  })

  it('expectTransition 非法迁移抛错', () => {
    expect(expectTransition('pending_review', 'published')).toBe('published')
    expect(() => expectTransition('collected', 'published')).toThrow(/非法审核状态迁移/)
  })
})
