import { describe, expect, it } from 'vitest'
import { roadmapNodeCreateSchema, roadmapNodeUpdateSchema } from '../roadmap'

const base = {
  year: 1,
  semester: 1,
  title: '英语四六级报名',
  lastMaintainedAt: '2026-10-01'
}

describe('roadmapNodeCreateSchema', () => {
  it('合法输入通过，relatedInfoIds 缺省为空数组', () => {
    const parsed = roadmapNodeCreateSchema.parse(base)
    expect(parsed.relatedInfoIds).toEqual([])
  })

  it('lastMaintainedAt 必填（R8）', () => {
    const { lastMaintainedAt: _drop, ...rest } = base
    expect(roadmapNodeCreateSchema.safeParse(rest).success).toBe(false)
  })

  it('lastMaintainedAt 须为合法 ISO 日期', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-13-99' }).success).toBe(false)
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-10-01T00:00:00+08:00' }).success).toBe(false)
  })

  it('year/semester 限 1-4 / 1-2', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, year: 5 }).success).toBe(false)
    expect(roadmapNodeCreateSchema.safeParse({ ...base, semester: 3 }).success).toBe(false)
  })
})

describe('roadmapNodeUpdateSchema', () => {
  it('partial 校验：空 patch 合法', () => {
    expect(roadmapNodeUpdateSchema.safeParse({}).success).toBe(true)
  })

  it('patch 不含 relatedInfoIds 时不会被默认值清空关联', () => {
    const parsed = roadmapNodeUpdateSchema.parse({ title: '新标题' })
    expect(parsed.relatedInfoIds).toBeUndefined()
    expect('relatedInfoIds' in parsed).toBe(false)
  })

  it('非法 lastMaintainedAt 仍被拒绝', () => {
    expect(roadmapNodeUpdateSchema.safeParse({ lastMaintainedAt: 'not-a-date' }).success).toBe(false)
  })

  it('空 patch 合法但不带任何默认值（防止误清字段）', () => {
    expect(roadmapNodeUpdateSchema.parse({})).toEqual({})
    expect(roadmapNodeUpdateSchema.parse({ year: 3 })).toEqual({ year: 3 })
  })
})

describe('【已整改 SN-39】lastMaintainedAt 改真实日历校验（与 SN-08 同源）', () => {
  /**
   * 【整改记录 SN-39】
   * 原缺陷：与 shared/domain/deadline.ts 的 SN-08 同源——refine 用
   * `new Date(`${s}T00:00:00+08:00`)` 判合法，而 V8 对**日域越界**会顺延
   * （2026-02-30 → 2026-03-02）而非返回 Invalid，因此不存在的日期可写入 roadmap_node。
   * 现整改：改用 shared/domain/date 的 isValidCalendarDate 真实日历校验
   * （含闰年 2/29），日域越界一律拒绝。
   */
  it('已整改：2026-02-30 被拒绝', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-02-30' }).success).toBe(false)
    expect(roadmapNodeUpdateSchema.safeParse({ lastMaintainedAt: '2026-02-30' }).success).toBe(false)
  })

  it('已整改：2026-04-31（4 月无 31 日）被拒绝', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-04-31' }).success).toBe(false)
  })

  it('对照：月份越界 2026-13-01 仍被拒绝', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-13-01' }).success).toBe(false)
  })

  it('已整改：闰年 2/29 合法、平年 2/29 非法', () => {
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2028-02-29' }).success).toBe(true)
    // 2026 非闰年，2/29 不存在；整改后不再被顺延放行
    expect(roadmapNodeCreateSchema.safeParse({ ...base, lastMaintainedAt: '2026-02-29' }).success).toBe(false)
  })
})
