import { describe, expect, it } from 'vitest'
import { checkPublishable } from '../publish-gate'

const deadline = { date: '2026-11-04', precision: 'date' as const, tz: 'Asia/Shanghai' }

describe('checkPublishable', () => {
  it('无来源信息禁止发布', () => {
    expect(checkPublishable({ sourceUrl: '', sourceChannel: '', deadlineVerifiedByHuman: true }))
      .toEqual({ ok: false, reason: 'missing_source' })
  })

  it('deadline 未经人工复核禁止发布（R12）', () => {
    expect(checkPublishable({
      sourceUrl: 'https://example.edu/notice/1',
      sourceChannel: '',
      deadline,
      deadlineVerifiedByHuman: false
    })).toEqual({ ok: false, reason: 'deadline_unverified' })
  })

  it('有来源 + 截止已复核 → 可发布', () => {
    expect(checkPublishable({
      sourceUrl: 'https://example.edu/notice/1',
      sourceChannel: '教务处',
      deadline,
      deadlineVerifiedByHuman: true
    })).toEqual({ ok: true })
  })

  it('无 deadline 的信息不校验复核标记', () => {
    expect(checkPublishable({
      sourceUrl: '',
      sourceChannel: '就业处',
      deadlineVerifiedByHuman: false
    })).toEqual({ ok: true })
  })

  it('来源字段含空白字符视为缺失', () => {
    expect(checkPublishable({
      sourceUrl: '   ',
      sourceChannel: '  ',
      deadlineVerifiedByHuman: true
    })).toEqual({ ok: false, reason: 'missing_source' })
  })
})

describe('【缺陷 SN-12】AGENT.md §3.3 与 §4.4 对来源要求自相矛盾，代码按 §4.4 实现', () => {
  /**
   * §3.3 数据模型写「sourceUrl+sourceChannel 必填」（二者都要），
   * §4.4 写「sourceUrl || sourceChannel 缺失的记录无法进入 published」（至少一个）。
   * 代码实现的是 §4.4 的 OR 语义。两处规范不一致，需在 AGENT.md 收敛为单一结论。
   * 本用例锁定当前实现（OR），供规范修订时对照。
   */
  it('当前行为：只填 sourceChannel、sourceUrl 为空 → 允许发布', () => {
    expect(checkPublishable({
      sourceUrl: '',
      sourceChannel: '教务处',
      deadlineVerifiedByHuman: true
    })).toEqual({ ok: true })
  })
})

describe('【缺陷 SN-13】checkPublishable 不校验 sourceType', () => {
  /**
   * §3.3 把 sourceType 列为 information 关键字段，但发布门禁只看
   * sourceUrl / sourceChannel，sourceType 缺失或非法也不拦截。
   */
  it('当前行为：sourceType 不参与发布门禁判定', () => {
    const input = {
      sourceUrl: 'https://example.edu/notice/1',
      sourceChannel: '',
      deadlineVerifiedByHuman: true
    }
    expect(checkPublishable(input)).toEqual({ ok: true })
  })
})
