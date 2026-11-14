/**
 * job-remind 处理器测试（阶段二）
 * 重点：授权余量（quota）记账、幂等去重、失败不静默（R11）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../job-remind/src/index'
import { __reset, __rows, __seed, __setSendBehavior, sentMessages } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

/** 与 lib/llm.ts / job-remind 同款取环境变量方式（本工程未安装 @types/node，不用裸 process） */
const env = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})

/** 固定「当前时刻」为 2026-11-01 09:30(+08:00) */
const NOW = new Date('2026-11-01T09:30:00+08:00')

const infoDoc = (id: string, date = '2026-11-04') => ({
  _id: id,
  title: `竞赛报名通知 ${id}`,
  category: 'opportunity',
  deadline: { date, precision: 'date', tz: 'Asia/Shanghai' },
  deadlineVerifiedByHuman: true,
  sourceUrl: `https://example.edu/${id}`,
  sourceChannel: '教务处',
  sourceType: 'official_site',
  contentHash: `hash_${id}`,
  reviewStatus: 'published',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z'
})

const subRecord = (over: Record<string, unknown> = {}) => ({
  _id: 'sr_1',
  openId: 'openid_a',
  templateId: 'tpl_test',
  quota: 1,
  subscribedAt: '2026-10-30T00:00:00.000Z',
  ...over
})

beforeEach(() => {
  __reset()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  env.REMIND_TEMPLATE_ID = 'tpl_test'
})
afterEach(() => {
  vi.useRealTimers()
  delete env.REMIND_TEMPLATE_ID
})

describe('remindDue · 基本行为', () => {
  it('未配置模板 ID 时显式报错，不静默跳过', async () => {
    env.REMIND_TEMPLATE_ID = ''
    const res = (await main({ action: 'remind.due' })) as R
    expect(res.code).toBe(400)
    expect(res.message).toContain('模板 ID')
    expect(sentMessages).toHaveLength(0)
  })

  it('有授权余量的用户收到提醒，余量扣减 1，写 reminder_log', async () => {
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord()])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])

    const res = (await main({ action: 'remind.due' })) as R
    expect(res.code).toBe(0)
    expect(sentMessages).toHaveLength(1)
    expect(__rows('subscribe_record')[0]?.quota).toBe(0)
    expect(__rows('reminder_log')).toHaveLength(1)
    expect(__rows('reminder_log')[0]?.status).toBe('sent')
    expect(__rows('reminder_log')[0]?.remindAt).toBe('2026-11-01T01:00:00.000Z')
  })

  it('余量归零后同步把 user.subscribeState 置为 none', async () => {
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord()])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])
    await main({ action: 'remind.due' })
    expect(__rows('user')[0]?.subscribeState).toBe('none')
  })

  it('quota=0 的用户不推送', async () => {
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord({ quota: 0 })])
    const res = (await main({ action: 'remind.due' })) as R
    expect(res.code).toBe(0)
    expect(sentMessages).toHaveLength(0)
    expect((res.data as { recipients: number }).recipients).toBe(0)
  })

  it('已过期的授权记录不计入', async () => {
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord({ expireAt: '2026-10-01T00:00:00.000Z' })])
    await main({ action: 'remind.due' })
    expect(sentMessages).toHaveLength(0)
  })

  it('窗口外的截止时间不触发提醒', async () => {
    __seed('information', [infoDoc('info_1', '2026-12-30')])
    __seed('subscribe_record', [subRecord()])
    await main({ action: 'remind.due' })
    expect(sentMessages).toHaveLength(0)
  })
})

describe('remindDue · 幂等去重（reminder_log）', () => {
  it('已发送过的 (infoId, remindAt, openId) 不重发', async () => {
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord()])
    __seed('reminder_log', [{
      infoId: 'info_1', remindAt: '2026-11-01T01:00:00.000Z', openId: 'openid_a', status: 'sent', at: 'x'
    }])
    const res = (await main({ action: 'remind.due' })) as R
    expect(sentMessages).toHaveLength(0)
    expect((res.data as { skipped: number }).skipped).toBe(1)
  })
})

describe('remindDue · 推送失败不静默（R11）', () => {
  it('失败写 push_fail 与 reminder_log(status=failed)', async () => {
    __setSendBehavior(() => ({ errCode: 43101, errMsg: 'user refuse' }))
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord()])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])

    const res = (await main({ action: 'remind.due' })) as R
    expect(res.code).toBe(0)
    expect(__rows('push_fail')).toHaveLength(1)
    expect((__rows('push_fail')[0]?.reason as string)).toContain('43101')
    expect(__rows('reminder_log')[0]?.status).toBe('failed')
    // 失败不消耗授权余量
    expect(__rows('subscribe_record')[0]?.quota).toBe(1)
  })

  it('失败也写 reminder_log，因此该提醒点不会在下次重试', async () => {
    __setSendBehavior(() => ({ errCode: 43101, errMsg: 'transient' }))
    __seed('information', [infoDoc('info_1')])
    __seed('subscribe_record', [subRecord()])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])

    await main({ action: 'remind.due' })
    expect(sentMessages).toHaveLength(1)

    // 第二次运行：提醒点已被记为 failed，不再尝试
    __setSendBehavior(() => ({ errCode: 0 }))
    const res = (await main({ action: 'remind.due' })) as R
    expect(sentMessages).toHaveLength(1)
    expect((res.data as { skipped: number }).skipped).toBe(1)
  })
})

describe('【已整改 SN-22】授权余量在循环内递减，一次运行内不超发', () => {
  /**
   * 【整改记录 SN-22】
   * 原缺陷：remindDue 的三重循环里 `rec` 来自一次查询快照，循环内从不改写 rec.quota，
   * 每次都用 `rec.quota - 1` 写库，同一次运行命中多个提醒点时按原始 quota 计算，
   * quota=1 也会连续推送多条（实测 2 条），超出「一次性授权 = 1 次可推送」的语义（R11）。
   * 现整改：循环内维护剩余余量（rec.remaining）并逐次递减，余量用尽即停止。
   */
  it('已整改：quota=1、2 条信息 → 只推 1 条，最终 quota=0', async () => {
    // 两条不同信息、同一截止日 → 各产生一个本次到期的提醒点
    __seed('information', [infoDoc('info_1'), infoDoc('info_2')])
    __seed('subscribe_record', [subRecord({ quota: 1 })])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])

    const res = (await main({ action: 'remind.due' })) as R
    expect((res.data as { sent: number }).sent).toBe(1)
    expect(sentMessages).toHaveLength(1)
    // 余量用尽即停止：最终余量 0，且不再超发
    expect(__rows('subscribe_record')[0]?.quota).toBe(0)
    expect(__rows('reminder_log')).toHaveLength(1)
  })

  it('已整改：quota=3、2 条信息 → 推 2 条，最终 quota=1（余量逐条递减）', async () => {
    __seed('information', [infoDoc('info_1'), infoDoc('info_2')])
    __seed('subscribe_record', [subRecord({ quota: 3 })])
    __seed('user', [{ openId: 'openid_a', subscribeState: 'active' }])

    await main({ action: 'remind.due' })
    expect(sentMessages).toHaveLength(2)
    // 原缺陷两次都写 3-1=2；整改后逐条递减：3-2=1
    expect(__rows('subscribe_record')[0]?.quota).toBe(1)
    expect(__rows('subscribe_record')[0]?.quota).not.toBe(2)
  })
})

describe('【已整改 SN-23】reminder_log 查询已从逐条改为按 infoId 预取', () => {
  /**
   * 【整改记录 SN-23】
   * 原缺陷：isAlreadyLogged 在三重循环内逐条查库，规模上界
   * BATCH_SIZE(100) × 提醒点(2) × RECIPIENT_LIMIT(500) = 10 万次读/小时。
   * 现整改：查询已从逐条改为按 infoId 预取（静态改动，无法用行为断言）。
   * 本用例改为断言运行期可见的正确性质：多用户多提醒点下，每个用户的总推送数不超过其 quota
   * （余量用尽即停止，不超发）。
   */
  it('多用户多提醒点下，每个用户的总推送数不超过其 quota', async () => {
    __seed('information', [infoDoc('info_1'), infoDoc('info_2'), infoDoc('info_3')])
    __seed('subscribe_record', [
      subRecord({ _id: 'sr_1', openId: 'openid_a', quota: 2 }),
      subRecord({ _id: 'sr_2', openId: 'openid_b', quota: 1 })
    ])

    const res = (await main({ action: 'remind.due' })) as R
    expect((res.data as { recipients: number }).recipients).toBe(2)

    const sentOf = (openId: string): number =>
      __rows('reminder_log').filter((l) => String(l.openId) === openId && String(l.status) === 'sent').length
    // 正确性质：单用户推送数不超过其余量
    expect(sentOf('openid_a')).toBeLessThanOrEqual(2)
    expect(sentOf('openid_b')).toBeLessThanOrEqual(1)
    // 余量用尽即停止：a 恰好用满 2、b 恰好用满 1，合计 3 条
    expect(sentOf('openid_a')).toBe(2)
    expect(sentOf('openid_b')).toBe(1)
    expect((res.data as { sent: number }).sent).toBe(3)
    expect(sentMessages).toHaveLength(3)
  })
})
