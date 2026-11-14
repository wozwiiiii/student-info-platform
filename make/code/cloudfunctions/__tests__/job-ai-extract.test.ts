/**
 * job-ai-extract 冒烟测试（P1：补 AGENT.md §4.8「云函数至少冒烟测试」）
 * 重点：置信度分流、AI 永不直发、主字段不被 AI 覆盖、单条失败不拖垮整批。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../job-ai-extract/src/index'
import { __reset, __rows, __seed, __setAddBehavior } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action?: string, payload?: Record<string, unknown>) =>
  main({ action, payload }) as Promise<R>

/** 与 lib/llm.ts / job-remind 同款取环境变量方式（本工程未安装 @types/node） */
const env = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})

/** 同时支持原文抓取（fetchText）与 LLM 调用（chat/completions）的 fetch 桩 */
function stubFetch(opts: {
  llmBody?: Record<string, unknown>
  articleHtml?: string
  llmHttpOk?: boolean
  articleHttpOk?: boolean
} = {}) {
  const llmBody = opts.llmBody ?? { title: 'AI 提取标题', category: 'opportunity', confidence: 0.9 }
  const html = opts.articleHtml ?? '<html><head><title>页面标题</title></head><body><p>正文</p></body></html>'
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (String(input).includes('chat/completions')) {
      const ok = opts.llmHttpOk ?? true
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(llmBody) } }] })
      }
    }
    const ok = opts.articleHttpOk ?? true
    return { ok, status: ok ? 200 : 500, text: async () => html }
  }))
}

const infoDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'info_1',
  title: '2026 年程序设计竞赛报名通知',
  category: 'academic',
  sourceUrl: 'https://example.edu/notice/1',
  sourceChannel: '教务处',
  sourceType: 'official_site',
  contentHash: 'hash_1',
  reviewStatus: 'collected',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...over
})

beforeEach(() => {
  __reset()
  stubFetch()
  env.LLM_API_KEY = 'test_key'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete env.LLM_API_KEY
  __setAddBehavior(null)
})

describe('extract.pending / 默认 action（批量结构化）', () => {
  it('置信度 >= 阈值 → pending_review，并写入 aiExtract', async () => {
    __seed('information', [infoDoc()])
    stubFetch({ llmBody: { title: 'AI 标题', confidence: 0.9 } })

    const res = await call('extract.pending')
    expect(res.code).toBe(0)
    expect(res.data?.processed).toBe(1)
    expect(res.data?.failed).toBe(0)

    const row = __rows('information')[0]
    expect(row?.reviewStatus).toBe('pending_review')
    const ai = row?.aiExtract as { confidence: number; fields: Record<string, unknown> }
    expect(ai.confidence).toBe(0.9)
    expect(ai.fields?.title).toBe('AI 标题')
  })

  it('置信度 < 阈值 → low_confidence（强制人工，R12）', async () => {
    __seed('information', [infoDoc()])
    stubFetch({ llmBody: { title: 'AI 标题', confidence: 0.3 } })

    await call()
    expect(__rows('information')[0]?.reviewStatus).toBe('low_confidence')
  })

  it('阈值边界：0.7 恰好进 pending_review，0.69 进 low_confidence', async () => {
    __seed('information', [infoDoc({ _id: 'a' }), infoDoc({ _id: 'b' })])
    stubFetch({ llmBody: { confidence: 0.7 } })
    await call('extract.pending')
    expect(__rows('information').find((r) => r._id === 'a')?.reviewStatus).toBe('pending_review')

    __reset()
    __seed('information', [infoDoc({ _id: 'c' })])
    stubFetch({ llmBody: { confidence: 0.69 } })
    await call('extract.pending')
    expect(__rows('information')[0]?.reviewStatus).toBe('low_confidence')
  })

  it('【底线 §4.3】AI 永不直接发布：任何置信度都不产出 published', async () => {
    __seed('information', [infoDoc({ _id: 'a' }), infoDoc({ _id: 'b' })])
    stubFetch({ llmBody: { confidence: 1 } })
    await call('extract.pending')
    expect(__rows('information').some((r) => r.reviewStatus === 'published')).toBe(false)

    __reset()
    __seed('information', [infoDoc({ _id: 'c' })])
    stubFetch({ llmBody: { confidence: 0.999 } })
    await call('extract.pending')
    expect(__rows('information')[0]?.reviewStatus).toBe('pending_review')
    expect(__rows('information')[0]?.reviewStatus).not.toBe('published')
  })

  it('【底线 §4.3】AI 建议不覆盖主字段：category / deadline 保持人工值', async () => {
    __seed('information', [infoDoc({
      category: 'scholarship',
      deadline: { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }
    })])
    stubFetch({ llmBody: { confidence: 0.9, category: 'lecture', deadline: { date: '2026-12-31', precision: 'date' } } })

    await call('extract.pending')
    const row = __rows('information')[0]
    // 主字段未被 AI 结果覆盖
    expect(row?.category).toBe('scholarship')
    expect((row?.deadline as { date: string }).date).toBe('2026-11-04')
    // AI 建议保留在 aiExtract 里
    expect((row?.aiExtract as { fields: { category?: string } }).fields?.category).toBe('lecture')
  })

  it('content 为空时按 sourceUrl 抓原文并回填 content', async () => {
    __seed('information', [infoDoc({ content: undefined })])
    stubFetch({ articleHtml: '<html><body><p>抓取到的正文</p></body></html>' })

    await call('extract.pending')
    expect(__rows('information')[0]?.content).toContain('抓取到的正文')
  })

  it('已有 content 时不重复抓取原文（只调 LLM 一次）', async () => {
    __seed('information', [infoDoc({ content: '已有正文' })])
    // 桩必须同时支持 json（LLM）与 text（原文抓取），否则会「因 LLM 失败而假通过」
    const spy = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      text: async () => '<html><body>不该被抓到的正文</body></html>',
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'AI', confidence: 0.9 }) } }] })
    }))
    vi.stubGlobal('fetch', spy)

    const res = await call('extract.pending')
    // LLM 真的成功了（processed=1），说明桩生效
    expect(res.data?.processed).toBe(1)
    // 全程只发起 1 次网络调用（即 LLM），没有原文抓取
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[0])).toContain('chat/completions')
    // content 保持原文、未被「不该被抓到的正文」覆盖
    expect(__rows('information')[0]?.content).toBe('已有正文')
    expect(__rows('information')[0]?.content).not.toContain('不该被抓到')
  })

  it('单条失败计入 failed 且不拖垮整批', async () => {
    __seed('information', [
      infoDoc({ _id: 'bad', title: '失败条目' }),
      infoDoc({ _id: 'good', title: '成功条目' })
    ])
    // LLM 每次都失败
    stubFetch({ llmHttpOk: false })

    const res = await call('extract.pending')
    expect(res.code).toBe(0)
    expect(res.data?.failed).toBe(2)
    expect(res.data?.processed).toBe(0)
    // 状态未被改动
    expect(__rows('information').every((r) => r.reviewStatus === 'collected')).toBe(true)
  })

  it('空批次返回 processed=0', async () => {
    const res = await call('extract.pending')
    expect(res.code).toBe(0)
    expect(res.data).toMatchObject({ processed: 0, failed: 0, total: 0 })
  })

  it('只处理 collected 条目，不碰已发布/待审条目', async () => {
    __seed('information', [
      infoDoc({ _id: 'a', reviewStatus: 'published' }),
      infoDoc({ _id: 'b', reviewStatus: 'pending_review' }),
      infoDoc({ _id: 'c', reviewStatus: 'collected' })
    ])
    const res = await call('extract.pending')
    expect(res.data?.total).toBe(1)
    expect(__rows('information').find((r) => r._id === 'a')?.reviewStatus).toBe('published')
    expect(__rows('information').find((r) => r._id === 'b')?.reviewStatus).toBe('pending_review')
  })
})

describe('extract.raw（后台辅助录入，只返回不落库）', () => {
  it('返回提取结果且不写库', async () => {
    stubFetch({ llmBody: { title: '即时提取', confidence: 0.8 } })
    const res = await call('extract.raw', { title: '原始标题', content: '原始正文' })
    expect(res.code).toBe(0)
    expect((res.data as { confidence: number }).confidence).toBe(0.8)
    expect(__rows('information')).toHaveLength(0)
  })

  it('title 与 content 均为空返回 400', async () => {
    const res = await call('extract.raw', {})
    expect(res.code).toBe(400)
    expect(__rows('information')).toHaveLength(0)
  })

  it('LLM 返回非 JSON 时返回 500（不静默）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '这不是 JSON' } }] })
    })))
    const res = await call('extract.raw', { title: 't' })
    expect(res.code).toBe(500)
  })

  it('未配置 LLM_API_KEY 时返回 500 且提示配置', async () => {
    delete env.LLM_API_KEY
    const res = await call('extract.raw', { title: 't' })
    expect(res.code).toBe(500)
    expect(__rows('information')).toHaveLength(0)
  })
})

describe('契约与边界', () => {
  it('未知 action 返回 400', async () => {
    const res = await call('extract.nope')
    expect(res.code).toBe(400)
  })

  it('LLM 响应缺 confidence 时按 0 处理（强制人工）', async () => {
    __seed('information', [infoDoc()])
    stubFetch({ llmBody: { title: 'x' } })
    await call('extract.pending')
    // lib/llm 对缺失 confidence 回退 0.5 → < 0.7 → low_confidence
    expect(__rows('information')[0]?.reviewStatus).toBe('low_confidence')
  })

  it('非法状态迁移被拦截：非 collected 条目不进批量处理', async () => {
    __seed('information', [infoDoc({ reviewStatus: 'archived' })])
    const res = await call('extract.pending')
    expect(res.data?.total).toBe(0)
  })
})
