/**
 * informationCreateSchema 单测（此前该 schema 无任何测试覆盖）
 * 命名约定：【已整改 SN-xx】= 原锁定「缺陷期错误行为」的用例，现改为断言整改后的正确行为，
 *          注释保留整改记录（原缺陷是什么、现在为什么是对的），便于审计追溯。
 */
import { describe, expect, it } from 'vitest'
import { deadlineSchema, informationCreateSchema, informationPatchSchema } from '../information'
import { isValidDeadline } from '../../domain/deadline'

const base = {
  title: '关于举办 2026 年程序设计竞赛的通知',
  category: 'opportunity' as const,
  sourceType: 'official_site' as const
}

describe('informationCreateSchema · 可溯源硬校验（AGENT.md §4.4）', () => {
  it('sourceUrl 与 sourceChannel 同时为空 → 校验失败', () => {
    const r = informationCreateSchema.safeParse({ ...base, sourceUrl: '', sourceChannel: '' })
    expect(r.success).toBe(false)
  })

  it('仅 sourceChannel 非空 → 通过', () => {
    const r = informationCreateSchema.safeParse({ ...base, sourceChannel: '教务处' })
    expect(r.success).toBe(true)
  })

  it('仅 sourceUrl 非空 → 通过', () => {
    const r = informationCreateSchema.safeParse({ ...base, sourceUrl: 'https://example.edu/notice/1' })
    expect(r.success).toBe(true)
  })

  it('空白字符不算来源（trim 后判定）', () => {
    const r = informationCreateSchema.safeParse({ ...base, sourceUrl: '   ', sourceChannel: '  ' })
    expect(r.success).toBe(false)
  })
})

describe('informationCreateSchema · 默认值', () => {
  it('deadlineVerifiedByHuman 不设默认值：字段已从 schema 移除，结果中无该 key', () => {
    const r = informationCreateSchema.parse({ ...base, sourceChannel: '教务处' })
    expect('deadlineVerifiedByHuman' in r).toBe(false)
    expect(r).not.toHaveProperty('deadlineVerifiedByHuman')
  })

  it('sourceUrl / sourceChannel 缺省补空串', () => {
    const r = informationCreateSchema.parse({ ...base, sourceChannel: '教务处' })
    expect(r.sourceUrl).toBe('')
    expect(r.sourceChannel).toBe('教务处')
  })

  it('title 去首尾空白后入库', () => {
    const r = informationCreateSchema.parse({ ...base, title: '  竞赛通知  ', sourceChannel: '教务处' })
    expect(r.title).toBe('竞赛通知')
  })
})

describe('【已整改 SN-01】deadlineVerifiedByHuman 不再由写入方自报', () => {
  /**
   * 【整改记录 SN-01】
   * 原缺陷：AGENT.md §4.3 规定该标记语义是「审核员已复核」，但 schema 接受写入方
   * 直接提交 true 并原样落库，于是「创建时自报 true → 后续发布」可绕过独立的人工复核动作。
   * 现整改：informationCreateSchema 不再含该字段，客户端提交的值被 zod 剥离，
   * parse 结果里没有这个 key；写入侧一律由服务端置 false，仅 info.review 审核动作可置 true。
   */
  it('已整改：客户端提交 deadlineVerifiedByHuman:true 被剥离，结果中无该 key', () => {
    const r = informationCreateSchema.safeParse({
      ...base,
      sourceChannel: '教务处',
      deadline: { date: '2026-11-04', precision: 'date' },
      deadlineVerifiedByHuman: true
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('deadlineVerifiedByHuman' in r.data).toBe(false)
      expect(r.data).not.toHaveProperty('deadlineVerifiedByHuman')
    }
  })
})

describe('【已整改 SN-02】deadlineSchema 强制 tz=Asia/Shanghai 与显式时区偏移', () => {
  /**
   * 【整改记录 SN-02】
   * 原缺陷：AGENT.md §3.3 要求「存储一律 ISO 8601 + 显式时区偏移」、tz 固定 Asia/Shanghai，
   * 但 deadlineSchema 对 tz 与偏移均不校验：tz 可为任意字符串，datetime 精度下无偏移裸串同样通过。
   * 现整改：tz 为 z.literal('Asia/Shanghai')（缺省补 Asia/Shanghai），
   * datetime 精度必须带 Z 或 ±HH:MM 偏移，否则 safeParse 失败。
   */
  it('已整改：tz=UTC / 任意串被拒绝，Asia/Shanghai 通过', () => {
    expect(deadlineSchema.safeParse({ date: '2026-11-04', precision: 'date', tz: 'UTC' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-11-04', precision: 'date', tz: '随便写' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }).success).toBe(true)
  })

  it('已整改：datetime 精度下无时区偏移的裸串被拒绝，带偏移串通过', () => {
    expect(deadlineSchema.safeParse({ date: '2026-11-04T18:00:00', precision: 'datetime' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-11-04', precision: 'datetime' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-11-04T18:00:00+08:00', precision: 'datetime' }).success).toBe(true)
    expect(deadlineSchema.safeParse({ date: '2026-11-04T18:00:00Z', precision: 'datetime' }).success).toBe(true)
  })

  it('tz 缺省时补 Asia/Shanghai', () => {
    expect(deadlineSchema.parse({ date: '2026-11-04', precision: 'date' }).tz).toBe('Asia/Shanghai')
  })
})

describe('deadlineSchema · 合法值', () => {
  it('date 精度接受 YYYY-MM-DD，非法格式拒绝', () => {
    expect(deadlineSchema.safeParse({ date: '2026-11-04', precision: 'date' }).success).toBe(true)
    expect(deadlineSchema.safeParse({ date: '2026-13-01', precision: 'date' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: 'not-a-date', precision: 'date' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-11-04T00:00:00+08:00', precision: 'date' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-1-4', precision: 'date' }).success).toBe(false)
  })
})

describe('【已整改 SN-08】不存在的日历日期被真实日历校验拒绝', () => {
  /**
   * 【整改记录 SN-08】
   * 原缺陷：`new Date('2026-02-30T00:00:00+08:00')` 被 V8 顺延到 3/2 而非 Invalid，
   * 因此 isValidDeadline 判合法、schema 放行，2 月 30 日这类不存在的截止日期可直接写库。
   * 现整改：date 精度改用真实日历校验（shared/domain/date 的 isValidCalendarDate），
   * 日域越界（含平年 2/29、4/31）一律拒绝，闰年 2/29 合法。
   */
  it('已整改：2026-02-30（不存在的日期）被判非法', () => {
    expect(deadlineSchema.safeParse({ date: '2026-02-30', precision: 'date' }).success).toBe(false)
    expect(isValidDeadline({ date: '2026-02-30', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
  })

  it('已整改：4/31、平年 2/29 拒绝，闰年 2/29 通过', () => {
    expect(deadlineSchema.safeParse({ date: '2026-04-31', precision: 'date' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-02-29', precision: 'date' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2028-02-29', precision: 'date' }).success).toBe(true)
  })

  it('已整改：datetime 精度同样做日域校验（原为已知边界，现已补齐）', () => {
    // 原契约只校验「带偏移 + 可解析」，'2026-02-30T10:00:00+08:00' 会被 V8 顺延而放行。
    // 现 isValidIsoDateTimeWithOffset 连日期部分一起校验，不存在的日子同样拒绝。
    expect(deadlineSchema.safeParse({ date: '2026-02-30T10:00:00+08:00', precision: 'datetime' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-04-31T10:00:00+08:00', precision: 'datetime' }).success).toBe(false)
    expect(deadlineSchema.safeParse({ date: '2026-02-29T10:00:00Z', precision: 'datetime' }).success).toBe(false)
    // 合法值仍然通过
    expect(deadlineSchema.safeParse({ date: '2026-02-28T10:00:00+08:00', precision: 'datetime' }).success).toBe(true)
    expect(deadlineSchema.safeParse({ date: '2028-02-29T10:00:00Z', precision: 'datetime' }).success).toBe(true)
    expect(deadlineSchema.safeParse({ date: '2026-13-01', precision: 'date' }).success).toBe(false)
  })
})

describe('informationCreateSchema · 边界长度', () => {
  it('title 超 200 字符拒绝、空标题拒绝', () => {
    expect(informationCreateSchema.safeParse({ ...base, title: 'x'.repeat(201), sourceChannel: '教务处' }).success).toBe(false)
    expect(informationCreateSchema.safeParse({ ...base, title: '   ', sourceChannel: '教务处' }).success).toBe(false)
    expect(informationCreateSchema.safeParse({ ...base, title: 'x'.repeat(200), sourceChannel: '教务处' }).success).toBe(true)
  })

  it('category / sourceType 非法枚举拒绝', () => {
    expect(informationCreateSchema.safeParse({ ...base, category: 'other', sourceChannel: '教务处' }).success).toBe(false)
    expect(informationCreateSchema.safeParse({ ...base, sourceType: 'unknown', sourceChannel: '教务处' }).success).toBe(false)
  })

  it('eventTime 复用 deadline 校验（精度语义待澄清，见测试文档）', () => {
    expect(informationCreateSchema.safeParse({
      ...base,
      sourceChannel: '教务处',
      eventTime: { date: '2026-11-04T09:00:00+08:00', precision: 'datetime' }
    }).success).toBe(true)
    expect(informationCreateSchema.safeParse({
      ...base,
      sourceChannel: '教务处',
      eventTime: { date: 'garbage', precision: 'datetime' }
    }).success).toBe(false)
  })
})

describe('informationPatchSchema · 信息更新补丁校验（整改 SN-17 新增导出）', () => {
  it('空 patch 合法且不带任何默认值（partial）', () => {
    expect(informationPatchSchema.safeParse({}).success).toBe(true)
    expect(informationPatchSchema.parse({})).toEqual({})
  })

  it('单字段部分更新通过，未提供的字段不出现在结果中', () => {
    const r = informationPatchSchema.parse({ title: '新标题', location: '教三 101' })
    expect(r.title).toBe('新标题')
    expect(r.location).toBe('教三 101')
    expect('sourceUrl' in r).toBe(false)
    expect('deadline' in r).toBe(false)
  })

  it('非法字段值拒绝：空标题 / 非法 deadline / 超长 location', () => {
    expect(informationPatchSchema.safeParse({ title: '' }).success).toBe(false)
    expect(informationPatchSchema.safeParse({ deadline: { date: 'garbage', precision: 'date' } }).success).toBe(false)
    expect(informationPatchSchema.safeParse({ location: 'x'.repeat(201) }).success).toBe(false)
    expect(informationPatchSchema.safeParse({ category: 'other' }).success).toBe(false)
  })

  it('deadline 补丁同样强制 tz 与日历合法（复用 deadlineSchema）', () => {
    expect(informationPatchSchema.safeParse({
      deadline: { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }
    }).success).toBe(true)
    expect(informationPatchSchema.safeParse({
      deadline: { date: '2026-11-04', precision: 'date', tz: 'UTC' }
    }).success).toBe(false)
    expect(informationPatchSchema.safeParse({
      deadline: { date: '2026-02-30', precision: 'date' }
    }).success).toBe(false)
  })
})
