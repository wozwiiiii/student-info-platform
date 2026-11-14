/**
 * api-submission 处理器测试（阶段二）
 * 用 wx-server-sdk 内存桩驱动 reviewSubmission，验证投稿接受链路的幂等与状态一致性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../api-submission/src/index'
import { __reset, __rows, __seed, __setOpenId } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action: string, payload: Record<string, unknown>): Promise<R> =>
  main({ action, payload }) as Promise<R>

const HTML = '<html><head><title>2026 年程序设计竞赛报名通知</title></head><body><p>正文内容</p></body></html>'

function stubFetch(html = HTML) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html })))
}

const submission = (over: Record<string, unknown> = {}) => ({
  _id: 'sub_1',
  submitterOpenId: 'openid_a',
  url: 'https://example.edu/notice/1',
  sourceChannel: '教务处',
  note: '',
  status: 'pending',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...over
})

beforeEach(() => {
  __reset()
  __setOpenId('openid_a')
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submission.create', () => {
  it('合法投稿落库并返回 pending', async () => {
    const res = await call('submission.create', { url: 'https://example.edu/notice/1' })
    expect(res.code).toBe(0)
    expect(__rows('submission')).toHaveLength(1)
    expect(__rows('submission')[0]?.status).toBe('pending')
    expect(__rows('submission')[0]?.submitterOpenId).toBe('openid_a')
  })

  it('非法 payload 返回 400 且不落库', async () => {
    const res = await call('submission.create', { url: 'not-a-url' })
    expect(res.code).toBe(400)
    expect(__rows('submission')).toHaveLength(0)
  })

  it('同链接重复投稿幂等返回既有记录', async () => {
    __seed('submission', [submission()])
    const res = await call('submission.create', { url: 'https://example.edu/notice/1' })
    expect(res.code).toBe(0)
    expect(res.data?.duplicate).toBe(true)
    expect(__rows('submission')).toHaveLength(1)
  })

  it('未知 action 返回 400', async () => {
    const res = await call('submission.nope', {})
    expect(res.code).toBe(400)
  })
})

describe('submission.review · accept', () => {
  it('接受后抓取原文入库 collected，并置投稿为 accepted', async () => {
    __seed('submission', [submission()])
    const res = await call('submission.review', { id: 'sub_1', action: 'accept' })
    expect(res.code).toBe(0)
    expect(res.data?.status).toBe('accepted')

    const info = __rows('information')[0]
    expect(info?.reviewStatus).toBe('collected')
    expect(info?.deadlineVerifiedByHuman).toBe(false)
    expect(info?.sourceType).toBe('user_submission')
    expect(info?.sourceUrl).toBe('https://example.edu/notice/1')
  })

  it('抓取失败返回 422 且不入库', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })))
    __seed('submission', [submission()])
    const res = await call('submission.review', { id: 'sub_1', action: 'accept' })
    expect(res.code).toBe(422)
    expect(__rows('information')).toHaveLength(0)
    expect(__rows('submission')[0]?.status).toBe('pending')
  })

  it('无法提取标题返回 422（人工补录兜底）', async () => {
    stubFetch('<html><body>无标题页面</body></html>')
    __seed('submission', [submission()])
    const res = await call('submission.review', { id: 'sub_1', action: 'accept' })
    expect(res.code).toBe(422)
    expect(__rows('information')).toHaveLength(0)
  })

  it('reject / duplicate 仅更新状态，不产生 information', async () => {
    __seed('submission', [submission()])
    await call('submission.review', { id: 'sub_1', action: 'reject' })
    expect(__rows('information')).toHaveLength(0)
  })

  it('非法 action 返回 400', async () => {
    __seed('submission', [submission()])
    const res = await call('submission.review', { id: 'sub_1', action: 'hack' })
    expect(res.code).toBe(400)
  })

  it('不存在的投稿返回 404', async () => {
    const res = await call('submission.review', { id: 'nope', action: 'accept' })
    expect(res.code).toBe(404)
  })
})

describe('【已整改 SN-15】已终态投稿重复 review 幂等返回，不再改写状态、不再重复抓取', () => {
  /**
   * 【整改记录 SN-15】
   * 原缺陷：reviewSubmission 未做状态机校验（对比 api-admin.reviewInfo 有 canTransition），
   * 也不做「已处理即幂等」判断。第二次 accept 会再次抓取、再次查重，
   * 命中自己第一次入库的 information 后把投稿状态改写为 duplicate。
   * 结果：明明已入库成功，投稿却显示为重复；且每次重放都多一次真实网络抓取。
   * 现整改：已终态（accepted/rejected/duplicate）的投稿一律幂等返回
   * { id, status, alreadyReviewed: true }，不改写状态、不再发起抓取。
   */
  it('已整改：第二次 accept 幂等返回 alreadyReviewed:true，status 保持 accepted，抓取只发生 1 次', async () => {
    __seed('submission', [submission()])

    const first = await call('submission.review', { id: 'sub_1', action: 'accept' })
    expect(first.data?.status).toBe('accepted')
    expect(__rows('submission')[0]?.status).toBe('accepted')

    const second = await call('submission.review', { id: 'sub_1', action: 'accept' })
    expect(second.code).toBe(0)
    expect(second.data?.alreadyReviewed).toBe(true)
    expect(second.data?.status).toBe('accepted')
    expect(__rows('submission')[0]?.status).toBe('accepted')
    // information 只有一条，状态未被翻转成 duplicate
    expect(__rows('information')).toHaveLength(1)
    // 已终态幂等：不再发起真实抓取
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('【已整改 SN-16】reject 写入契约内的状态值 rejected', () => {
  /**
   * 【整改记录 SN-16】
   * 原缺陷：shared/types/submission.ts 定义 status: 'pending'|'accepted'|'rejected'|'duplicate'，
   * 但 api-submission 直接 `update({ status: action })`，action 是 'reject'（无 d），
   * 实际写入 'reject'，与契约类型不符——按 'rejected' 过滤的查询永远查不到被驳回的投稿。
   * 现整改：action → status 走映射，reject 写入 'rejected'。
   */
  it('已整改：reject 写入 "rejected" 而非 "reject"', async () => {
    __seed('submission', [submission()])
    const res = await call('submission.review', { id: 'sub_1', action: 'reject' })
    expect(res.data?.status).toBe('rejected')
    expect(__rows('submission')[0]?.status).toBe('rejected')
    expect(__rows('submission')[0]?.status).not.toBe('reject')
  })
})
