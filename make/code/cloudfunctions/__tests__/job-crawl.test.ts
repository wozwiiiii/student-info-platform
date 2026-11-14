/**
 * job-crawl 冒烟测试（P1：补 AGENT.md §4.8「云函数至少冒烟测试」）
 * 重点：关键词过滤、contentHash 去重、可靠性留痕（R10）、采集态入库不直发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../job-crawl/src/index'
import { __reset, __rows, __seed } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action?: string) => main({ action }) as Promise<R>

function stubFetch(html: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => html })))
}

/** 列表页：含 3 条成长相关链接 + 2 条噪音链接 */
const LIST_PAGE = [
  '<html><body>',
  '<a href="/n1">关于举办程序设计竞赛的通知</a>',
  '<a href="/n2">2026 届春季校园招聘</a>',
  '<a href="/n3">国家奖学金评审办法</a>',
  '<a href="/x1">学校食堂本周菜单</a>',
  '<a href="/x2">图书馆开放时间调整</a>',
  '</body></html>'
].join('')

const sourceDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'src_1',
  name: '教务处官网',
  type: 'official_site',
  monitorMethod: 'scheduled_crawl',
  homepageUrl: 'https://example.edu/list',
  reliability: 0.5,
  ...over
})

beforeEach(() => {
  __reset()
  stubFetch(LIST_PAGE)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('crawl.run / 默认 action', () => {
  it('关键词过滤后入库为 collected（不直发）', async () => {
    __seed('source', [sourceDoc()])
    const res = await call('crawl.run')
    expect(res.code).toBe(0)
    expect(res.data?.added).toBe(3)

    const rows = __rows('information')
    expect(rows).toHaveLength(3)
    // 【底线 §4.3】采集态入库，绝不直接发布
    expect(rows.every((r) => r.reviewStatus === 'collected')).toBe(true)
    expect(rows.every((r) => r.reviewStatus !== 'published')).toBe(true)
    // 【底线 §4.3 / R12】无人工复核不带复核标记
    expect(rows.every((r) => r.deadlineVerifiedByHuman === false)).toBe(true)
    // 【底线 §4.4】来源齐备
    expect(rows.every((r) => r.sourceUrl && r.sourceChannel)).toBe(true)
    expect(rows.every((r) => r.sourceType === 'official_site')).toBe(true)
  })

  it('非成长相关链接被 CRAWL_KEYWORDS 过滤掉', async () => {
    __seed('source', [sourceDoc()])
    await call('crawl.run')
    const titles = __rows('information').map((r) => r.title)
    expect(titles.some((t) => String(t).includes('食堂'))).toBe(false)
    expect(titles.some((t) => String(t).includes('图书馆'))).toBe(false)
    expect(titles.some((t) => String(t).includes('竞赛'))).toBe(true)
  })

  it('按链接文本做 contentHash 去重，重复条目跳过', async () => {
    __seed('source', [sourceDoc()])
    await call('crawl.run')
    expect(__rows('information')).toHaveLength(3)

    // 第二次爬同一页面：应全部命中去重，不再入库
    const res = await call('crawl.run')
    expect(res.data?.added).toBe(0)
    expect(__rows('information')).toHaveLength(3)
  })

  it('单源链接数超过 10 条被截断', async () => {
    const many = Array.from({ length: 15 }, (_, i) => `<a href="/m${i}">竞赛报名通知 ${i}</a>`).join('')
    stubFetch(`<html><body>${many}</body></html>`)
    __seed('source', [sourceDoc()])

    const res = await call('crawl.run')
    expect(res.data?.added).toBe(10) // MAX_LINKS_PER_SOURCE = 10
  })

  it('绝对链接保留、非法 href 跳过', async () => {
    stubFetch([
      '<html><body>',
      '<a href="https://other.edu/a">竞赛通知外链</a>',
      '<a href="http://">坏链</a>',
      '</body></html>'
    ].join(''))
    __seed('source', [sourceDoc()])
    const res = await call('crawl.run')
    expect(res.data?.added).toBe(1)
    expect(__rows('information')[0]?.sourceUrl).toBe('https://other.edu/a')
  })

  it('来源标题按 classifyByTitle 归类', async () => {
    stubFetch('<html><body><a href="/n1">国家奖学金评审办法</a></body></html>')
    __seed('source', [sourceDoc()])
    await call('crawl.run')
    expect(__rows('information')[0]?.category).toBe('scholarship')
  })
})

describe('可靠性留痕（R10）', () => {
  it('爬取成功 reliability 上升并刷新 lastFetchedAt', async () => {
    __seed('source', [sourceDoc({ reliability: 0.5 })])
    await call('crawl.run')
    const src = __rows('source')[0]
    expect(src?.reliability).toBeCloseTo(0.52, 5)
    expect(typeof src?.lastFetchedAt).toBe('string')
  })

  it('reliability 上升有上限 1，不会溢出', async () => {
    __seed('source', [sourceDoc({ reliability: 0.99 })])
    await call('crawl.run')
    expect(__rows('source')[0]?.reliability).toBe(1)
  })

  it('抓取失败 reliability 下降 0.1 且下限为 0，failedSources 计数', async () => {
    stubFetch('', false)
    __seed('source', [sourceDoc({ reliability: 0.5 }), sourceDoc({ _id: 'src_2', reliability: 0.05 })])

    const res = await call('crawl.run')
    expect(res.code).toBe(0)
    expect(res.data?.failedSources).toBe(2)
    expect(res.data?.added).toBe(0)
    expect(__rows('source').find((s) => s._id === 'src_1')?.reliability).toBeCloseTo(0.4, 5)
    expect(__rows('source').find((s) => s._id === 'src_2')?.reliability).toBe(0) // 不为负
  })

  it('无 homepageUrl 的源判失败，不入库', async () => {
    __seed('source', [sourceDoc({ homepageUrl: '' })])
    const res = await call('crawl.run')
    expect(res.data?.failedSources).toBe(1)
    expect(__rows('information')).toHaveLength(0)
  })
})

describe('源筛选与契约', () => {
  it('只处理 monitorMethod=scheduled_crawl 的源', async () => {
    __seed('source', [
      sourceDoc({ _id: 'a', name: '定时爬取源' }),
      sourceDoc({ _id: 'b', name: '半自动监控源', monitorMethod: 'manual_import' })
    ])
    const res = await call('crawl.run')
    expect(res.data?.sources).toBe(1)
    expect(__rows('information').every((r) => r.sourceChannel === '定时爬取源')).toBe(true)
  })

  it('单源上限 20 条', async () => {
    __seed('source', Array.from({ length: 25 }, (_, i) => sourceDoc({ _id: `s${i}`, name: `源${i}` })))
    const res = await call('crawl.run')
    expect(res.data?.sources).toBe(20)
  })

  it('未知 action 返回 400', async () => {
    expect((await call('crawl.nope')).code).toBe(400)
  })

  it('空库返回 sources=0', async () => {
    const res = await call()
    expect(res.code).toBe(0)
    expect(res.data).toMatchObject({ sources: 0, added: 0, failedSources: 0 })
  })
})
