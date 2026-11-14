import { describe, expect, it } from 'vitest'
import { subscribeRecordSchema, userProfileSchema } from '../user'

describe('userProfileSchema', () => {
  it('学院/年级选填，允许空对象', () => {
    expect(userProfileSchema.safeParse({}).success).toBe(true)
    expect(userProfileSchema.safeParse({ college: '计算机学院', grade: '2024' }).success).toBe(true)
  })

  it('拒绝超长字段', () => {
    expect(userProfileSchema.safeParse({ college: 'x'.repeat(51) }).success).toBe(false)
    expect(userProfileSchema.safeParse({ grade: 'x'.repeat(21) }).success).toBe(false)
  })
})

describe('subscribeRecordSchema', () => {
  it('quota 默认 1（一次性授权）', () => {
    const parsed = subscribeRecordSchema.parse({ templateId: 'tpl_abc' })
    expect(parsed.quota).toBe(1)
  })

  it('templateId 必填，quota 限 1~100 整数', () => {
    expect(subscribeRecordSchema.safeParse({ templateId: '' }).success).toBe(false)
    expect(subscribeRecordSchema.safeParse({ templateId: 'tpl', quota: 0 }).success).toBe(false)
    expect(subscribeRecordSchema.safeParse({ templateId: 'tpl', quota: 1.5 }).success).toBe(false)
  })
})
