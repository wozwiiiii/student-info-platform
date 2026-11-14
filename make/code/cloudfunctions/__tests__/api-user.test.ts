/**
 * api-user 处理器冒烟测试（M5：track.activity / track.event 埋点）
 * 重点：每日活跃幂等去重、事件校验、无 OPENID 返回 401。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { main } from '../api-user/src/index'
import { __reset, __rows, __setOpenId } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action: string, payload: Record<string, unknown> = {}) =>
  main({ action, payload }) as Promise<R>

beforeEach(() => {
  __reset()
  __setOpenId('openid_a')
})

describe('track.activity（周活埋点）', () => {
  it('首次上报落 activity_log，同日重复上报幂等不重复入库', async () => {
    const first = await call('track.activity')
    expect(first.code).toBe(0)
    expect(first.data?.recorded).toBe(true)

    const second = await call('track.activity')
    expect(second.code).toBe(0)
    expect(second.data?.recorded).toBe(false)
    expect(__rows('activity_log')).toHaveLength(1)
  })

  it('记录 openId 与当天日期（Asia/Shanghai YYYY-MM-DD）', async () => {
    await call('track.activity')
    const row = __rows('activity_log')[0]
    expect(row?.openId).toBe('openid_a')
    expect(String(row?.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('无 OPENID 返回 401', async () => {
    __setOpenId('')
    expect((await call('track.activity')).code).toBe(401)
    expect(__rows('activity_log')).toHaveLength(0)
  })
})

describe('track.event（订阅消息回流打开埋点）', () => {
  it('写 event_log，infoId 可选', async () => {
    const res = await call('track.event', { type: 'open_remind', infoId: 'info_1' })
    expect(res.code).toBe(0)
    const row = __rows('event_log')[0]
    expect(row?.type).toBe('open_remind')
    expect(row?.infoId).toBe('info_1')
  })

  it('未知事件类型返回 400，不落库', async () => {
    const res = await call('track.event', { type: 'page_view' })
    expect(res.code).toBe(400)
    expect(__rows('event_log')).toHaveLength(0)
  })

  it('无 OPENID 返回 401', async () => {
    __setOpenId('')
    expect((await call('track.event', { type: 'open_remind' })).code).toBe(401)
  })
})

describe('【已整改 SN-47】track.event 按 (openId, type, infoId) 幂等，重复上报不再刷高打开率', () => {
  /**
   * 【整改记录 SN-47】
   * 原缺陷：trackEvent 直接 add 到 event_log，无去重键、无频控、无上限。
   * metrics.dashboard 的 reminderOpens 直接 count(event_log.type='open_remind')，
   * 同一用户反复上报即可无限抬高「打开率」，看板数据不可信。
   * 现整改：按 (openId, type, infoId) 幂等，重复上报只记 1 条，
   * 返回 { openId, recorded: false } 表示重复未记入。
   */
  it('已整改：同用户同 infoId 重复上报 5 次 → 只记 1 条，重复返回 recorded:false', async () => {
    const first = await call('track.event', { type: 'open_remind', infoId: 'info_1' })
    expect(first.data?.recorded).toBe(true)
    expect(first.data?.openId).toBe('openid_a')

    for (let i = 0; i < 4; i++) {
      const again = await call('track.event', { type: 'open_remind', infoId: 'info_1' })
      expect(again.code).toBe(0)
      expect(again.data?.recorded).toBe(false)
      expect(again.data?.openId).toBe('openid_a')
    }
    expect(__rows('event_log')).toHaveLength(1)
    expect(__rows('event_log')[0]?.infoId).toBe('info_1')
  })

  it('对照：track.activity 同日重复上报只记 1 条', async () => {
    await call('track.activity')
    await call('track.activity')
    await call('track.activity')
    expect(__rows('activity_log')).toHaveLength(1)
  })
})

describe('【已整改 SN-25】subscribe.record 同 (openId, templateId) 60 秒窗口内幂等，不虚增授权余量', () => {
  /**
   * 【整改记录 SN-25】
   * 原缺陷：recordSubscribe 每次都 add 一条 subscribe_record，无去重键。
   * 客户端网络重试（或重复点击）会为同一次「一次性授权」记多条 quota，
   * 直接违反 R11「一次性授权 = 1 次可推送」。
   * 现整改：同 (openId, templateId) 在 60 秒去重窗口内幂等，重复上报返回 duplicate:true，
   * 不再新增记录、不虚增 totalQuota。
   */
  it('已整改：同用户同模板 60 秒内上报 3 次 → 记 1 条、totalQuota=1，重复返回 duplicate:true', async () => {
    const first = await call('subscribe.record', { templateId: 'tpl_a' })
    expect(first.code).toBe(0)
    expect(first.data?.duplicate).toBeUndefined()

    for (let i = 0; i < 2; i++) {
      const again = await call('subscribe.record', { templateId: 'tpl_a' })
      expect(again.code).toBe(0)
      expect(again.data?.duplicate).toBe(true)
    }
    expect(__rows('subscribe_record')).toHaveLength(1)
    const res = await call('subscribe.status')
    expect((res.data as { totalQuota: number }).totalQuota).toBe(1)
  })

  it('quota 上限 100 被 schema 拦截（防误传）', async () => {
    const res = await call('subscribe.record', { templateId: 'tpl_a', quota: 101 })
    expect(res.code).toBe(400)
    expect(__rows('subscribe_record')).toHaveLength(0)
  })
})

describe('subscribe.status / user.profile 基本行为', () => {
  it('首次登录 created=true，重复登录 created=false 并幂等不重复建号', async () => {
    const first = await call('user.login')
    expect(first.data?.created).toBe(true)
    const second = await call('user.login')
    expect(second.data?.created).toBe(false)
    expect(__rows('user')).toHaveLength(1)
  })

  it('过期授权不计入 totalQuota', async () => {
    await call('subscribe.record', { templateId: 'tpl_a', expireAt: '2020-01-01T00:00:00.000Z' })
    await call('subscribe.record', { templateId: 'tpl_b' })
    const res = await call('subscribe.status')
    expect((res.data as { totalQuota: number }).totalQuota).toBe(1)
    expect((res.data as { records: unknown[] }).records).toHaveLength(1)
  })

  it('user.profile 校验学院/年级并落库', async () => {
    await call('user.login')
    const res = await call('user.profile', { college: '计算机学院', grade: '2024' })
    expect(res.code).toBe(0)
    expect(__rows('user')[0]?.college).toBe('计算机学院')
  })

  it('user.profile 超长字段返回 400', async () => {
    await call('user.login')
    expect((await call('user.profile', { college: 'x'.repeat(51) })).code).toBe(400)
  })
})
