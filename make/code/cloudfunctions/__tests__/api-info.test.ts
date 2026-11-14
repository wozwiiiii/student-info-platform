/**
 * api-info 处理器测试（A1 信息流 / A2 分类 / A3 Deadline 日历 / M4 roadmap.list）
 * 重点：只返回已发布条目、_id → id 映射、分页、日历窗口与排序。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../api-info/src/index'
import { __reset, __seed } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action: string, payload: Record<string, unknown> = {}) =>
  main({ action, payload }) as Promise<R>

beforeEach(() => {
  __reset()
})

describe('roadmap.list（A4）', () => {
  const node = (over: Record<string, unknown> = {}) => ({
    _id: 'node_1',
    year: 2,
    semester: 1,
    title: '数学建模竞赛',
    relatedInfoIds: ['info_pub', 'info_draft'],
    lastMaintainedAt: '2026-10-01',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over
  })

  it('返回 id 映射后的节点，且只内嵌已发布关联信息', async () => {
    __seed('roadmap_node', [node()])
    __seed('information', [
      { _id: 'info_pub', title: '已发布', reviewStatus: 'published', publishedAt: '2026-10-02T00:00:00.000Z' },
      { _id: 'info_draft', title: '未发布', reviewStatus: 'pending_review' }
    ])
    const res = await call('roadmap.list')
    expect(res.code).toBe(0)
    const items = (res.data as { items: Array<Record<string, unknown>> }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('node_1')
    const related = items[0]?.relatedInfos as Array<Record<string, unknown>>
    expect(related).toHaveLength(1)
    expect(related[0]?.id).toBe('info_pub')
  })

  it('按学年+学期排序（shared/domain 分组排序）', async () => {
    __seed('roadmap_node', [
      node({ _id: 'n2', year: 3, semester: 1, title: '保研夏令营', relatedInfoIds: [] }),
      node({ _id: 'n1', year: 1, semester: 2, title: '英语四级', relatedInfoIds: [] })
    ])
    const res = await call('roadmap.list')
    const items = (res.data as { items: Array<Record<string, unknown>> }).items
    expect(items.map((i) => i.id)).toEqual(['n1', 'n2'])
  })

  it('空库返回空列表', async () => {
    const res = await call('roadmap.list')
    expect(res.code).toBe(0)
    expect((res.data as { items: unknown[] }).items).toEqual([])
  })
})

/* ===================== P2：info.list / info.get / info.deadlines ===================== */

const infoDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'info_1',
  title: '2026 年程序设计竞赛报名通知',
  category: 'opportunity',
  subType: 'competition',
  sourceUrl: 'https://example.edu/notice/1',
  sourceChannel: '教务处',
  sourceType: 'official_site',
  contentHash: 'hash_1',
  reviewStatus: 'published',
  publishedAt: '2026-10-30T00:00:00.000Z',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...over
})

describe('info.list（A1 信息流 / A2 分类频道）', () => {
  it('只返回 published 条目，_id 映射为 id', async () => {
    __seed('information', [
      infoDoc({ _id: 'p1', title: '已发布一' }),
      infoDoc({ _id: 'd1', title: '待审核', reviewStatus: 'pending_review' }),
      infoDoc({ _id: 'r1', title: '已驳回', reviewStatus: 'rejected' })
    ])
    const res = await call('info.list')
    expect(res.code).toBe(0)
    const d = res.data as { items: Array<{ id: string }>; total: number }
    expect(d.total).toBe(1)
    expect(d.items).toHaveLength(1)
    expect(d.items[0]?.id).toBe('p1')
  })

  it('【底线 §4.3】未发布条目绝不外泄', async () => {
    __seed('information', [
      infoDoc({ _id: 'a', reviewStatus: 'collected' }),
      infoDoc({ _id: 'b', reviewStatus: 'low_confidence' }),
      infoDoc({ _id: 'c', reviewStatus: 'archived' }),
      infoDoc({ _id: 'd', reviewStatus: 'expired' }),
      infoDoc({ _id: 'e', reviewStatus: 'corrected' })
    ])
    const res = await call('info.list')
    expect((res.data as { total: number }).total).toBe(0)
    expect((res.data as { items: unknown[] }).items).toEqual([])
  })

  it('category / subType 过滤生效', async () => {
    // 注意：infoDoc 的 subType 默认值是 'competition'，此处必须逐条显式指定，否则会误算
    __seed('information', [
      infoDoc({ _id: 'a', category: 'opportunity', subType: 'competition' }),
      infoDoc({ _id: 'b', category: 'opportunity', subType: 'job_internship' }),
      infoDoc({ _id: 'c', category: 'scholarship', subType: 'other' })
    ])
    const byCat = await call('info.list', { category: 'scholarship' })
    expect((byCat.data as { total: number }).total).toBe(1)
    expect((byCat.data as { items: Array<{ id: string }> }).items[0]?.id).toBe('c')

    const bySub = await call('info.list', { subType: 'competition' })
    expect((bySub.data as { total: number }).total).toBe(1)
    expect((bySub.data as { items: Array<{ id: string }> }).items[0]?.id).toBe('a')

    // 两个条件同时给：取交集
    const both = await call('info.list', { category: 'opportunity', subType: 'job_internship' })
    expect((both.data as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(['b'])
  })

  it('分页：page/pageSize 生效并返回 total', async () => {
    __seed('information', Array.from({ length: 5 }, (_, i) => infoDoc({
      _id: `p${i}`, title: `通知${i}`, contentHash: `h${i}`, publishedAt: `2026-10-3${i}T00:00:00.000Z`
    })))
    const res = await call('info.list', { page: 2, pageSize: 2 })
    const d = res.data as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(d.total).toBe(5)
    expect(d.page).toBe(2)
    expect(d.pageSize).toBe(2)
    expect(d.items).toHaveLength(2)
  })

  it('pageSize 上限 50，非法分页参数收敛', async () => {
    __seed('information', [infoDoc()])
    const res = await call('info.list', { page: -3, pageSize: 9999 })
    const d = res.data as { page: number; pageSize: number }
    expect(d.page).toBe(1)
    expect(d.pageSize).toBe(50)
  })

  it('未知 action 返回 400', async () => {
    expect((await call('info.nope')).code).toBe(400)
  })
})

describe('info.get（信息详情）', () => {
  it('已发布条目返回详情并映射 id', async () => {
    __seed('information', [infoDoc({ _id: 'p1' })])
    const res = await call('info.get', { id: 'p1' })
    expect(res.code).toBe(0)
    expect((res.data as { id: string }).id).toBe('p1')
  })

  it('【底线 §4.3】未发布条目返回 404，不泄露内容', async () => {
    __seed('information', [infoDoc({ _id: 'd1', reviewStatus: 'pending_review' })])
    const res = await call('info.get', { id: 'd1' })
    expect(res.code).toBe(404)
    expect(res.data).toBeNull()
  })

  it('缺 id 返回 400，不存在的 id 返回 404', async () => {
    expect((await call('info.get', {})).code).toBe(400)
    expect((await call('info.get', { id: 'nope' })).code).toBe(404)
  })
})

describe('info.deadlines（A3 Deadline 日历）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00+08:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const withDeadline = (id: string, date: string, over: Record<string, unknown> = {}) =>
    infoDoc({ _id: id, title: `通知${id}`, contentHash: `h${id}`, deadline: { date, precision: 'date', tz: 'Asia/Shanghai' }, ...over })

  it('只返回窗口内截止的条目，按截止时刻升序', async () => {
    __seed('information', [
      withDeadline('far', '2026-12-30'),
      withDeadline('near', '2026-11-05'),
      withDeadline('soon', '2026-11-03')
    ])
    const res = await call('info.deadlines')
    const items = (res.data as { items: Array<{ id: string }> }).items
    expect(items.map((i) => i.id)).toEqual(['soon', 'near'])
  })

  it('无 deadline 的条目不进日历', async () => {
    __seed('information', [infoDoc({ _id: 'x' })])
    const res = await call('info.deadlines')
    expect((res.data as { items: unknown[] }).items).toEqual([])
  })

  it('已过去的截止时刻不进日历', async () => {
    __seed('information', [withDeadline('past', '2026-10-01')])
    const res = await call('info.deadlines')
    expect((res.data as { items: unknown[] }).items).toEqual([])
  })

  it('withinDays 收敛到 1~180', async () => {
    __seed('information', [withDeadline('a', '2026-11-05')])
    expect(((await call('info.deadlines', { withinDays: 0 })).data as { withinDays: number }).withinDays).toBe(1)
    expect(((await call('info.deadlines', { withinDays: 9999 })).data as { withinDays: number }).withinDays).toBe(180)
  })

  it('只返回 published 条目', async () => {
    __seed('information', [withDeadline('p', '2026-11-05'), withDeadline('d', '2026-11-05', { reviewStatus: 'pending_review' })])
    const res = await call('info.deadlines')
    expect((res.data as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(['p'])
  })
})
