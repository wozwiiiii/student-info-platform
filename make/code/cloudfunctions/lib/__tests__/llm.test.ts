/**
 * lib/llm.ts 单测（P2）
 * 重点：中英文枚举映射、置信度归一、deadline 归一、错误路径。
 * extractStructured 的全部归一逻辑都在本函数内，故经 fetch 桩驱动验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractStructured } from '../llm'

const env = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})

function stubLlm(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => ({ choices: [{ message: { content: typeof body === 'string' ? body : JSON.stringify(body) } }] })
  })))
}

beforeEach(() => {
  env.LLM_API_KEY = 'test_key'
  delete env.LLM_MODEL
  delete env.LLM_BASE_URL
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete env.LLM_API_KEY
  delete env.LLM_MODEL
  delete env.LLM_BASE_URL
})

describe('category / subType 中英文映射', () => {
  it('英文枚举直通', async () => {
    stubLlm({ category: 'opportunity', subType: 'competition', confidence: 0.9 })
    const r = await extractStructured('t', 'c')
    expect(r.fields.category).toBe('opportunity')
    expect(r.fields.subType).toBe('competition')
  })

  it('中文枚举被归一为契约值', async () => {
    stubLlm({ category: '机会成长', subType: '竞赛', confidence: 0.9 })
    const r = await extractStructured('t', 'c')
    expect(r.fields.category).toBe('opportunity')
    expect(r.fields.subType).toBe('competition')
  })

  it('奖助评优 / 教务通知 / 讲座活动 映射正确', async () => {
    stubLlm({ category: '奖助评优' })
    expect((await extractStructured('t', 'c')).fields.category).toBe('scholarship')
    stubLlm({ category: '教务通知' })
    expect((await extractStructured('t', 'c')).fields.category).toBe('academic')
    stubLlm({ category: '讲座活动' })
    expect((await extractStructured('t', 'c')).fields.category).toBe('lecture')
  })

  it('subType 中文：就业实习 / 保研 / 其他', async () => {
    stubLlm({ subType: '就业实习' })
    expect((await extractStructured('t', 'c')).fields.subType).toBe('job_internship')
    stubLlm({ subType: '保研' })
    expect((await extractStructured('t', 'c')).fields.subType).toBe('postgrad')
    stubLlm({ subType: '其他' })
    expect((await extractStructured('t', 'c')).fields.subType).toBe('other')
  })

  it('未知 / 非字符串枚举归一为 undefined（不写入脏值）', async () => {
    stubLlm({ category: '不存在的类别', subType: 123, confidence: 0.9 })
    const r = await extractStructured('t', 'c')
    expect(r.fields.category).toBeUndefined()
    expect(r.fields.subType).toBeUndefined()
  })

  it('带首尾空白的枚举先裁剪再映射', async () => {
    stubLlm({ category: '  竞赛  ' })
    // '竞赛' 不是合法 category（是 subType 词），应归一为 undefined
    expect((await extractStructured('t', 'c')).fields.category).toBeUndefined()
  })
})

describe('置信度归一', () => {
  it('超出 [0,1] 被夹到边界', async () => {
    stubLlm({ confidence: 1.5 })
    expect((await extractStructured('t', 'c')).confidence).toBe(1)
    stubLlm({ confidence: -3 })
    expect((await extractStructured('t', 'c')).confidence).toBe(0)
  })

  it('缺失或非数字回退 0.5', async () => {
    stubLlm({})
    expect((await extractStructured('t', 'c')).confidence).toBe(0.5)
    stubLlm({ confidence: 'high' })
    expect((await extractStructured('t', 'c')).confidence).toBe(0.5)
    stubLlm({ confidence: null })
    expect((await extractStructured('t', 'c')).confidence).toBe(0.5)
  })

  it('合法值原样保留', async () => {
    stubLlm({ confidence: 0.7 })
    expect((await extractStructured('t', 'c')).confidence).toBe(0.7)
  })
})

describe('deadline / eventTime 归一', () => {
  it('合法日期 + precision 原样保留，tz 固定 Asia/Shanghai', async () => {
    stubLlm({ deadline: { date: '2026-11-04', precision: 'date' }, confidence: 0.9 })
    const d = (await extractStructured('t', 'c')).fields.deadline
    expect(d).toEqual({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' })
  })

  it('precision 非 datetime 一律归一为 date', async () => {
    stubLlm({ deadline: { date: '2026-11-04', precision: 'whatever' } })
    expect((await extractStructured('t', 'c')).fields.deadline?.precision).toBe('date')
  })

  it('非法日期 / 空日期 / 非对象 归一为 undefined', async () => {
    stubLlm({ deadline: { date: 'not-a-date', precision: 'date' } })
    expect((await extractStructured('t', 'c')).fields.deadline).toBeUndefined()
    stubLlm({ deadline: { date: '', precision: 'date' } })
    expect((await extractStructured('t', 'c')).fields.deadline).toBeUndefined()
    stubLlm({ deadline: '2026-11-04' })
    expect((await extractStructured('t', 'c')).fields.deadline).toBeUndefined()
    stubLlm({ deadline: null })
    expect((await extractStructured('t', 'c')).fields.deadline).toBeUndefined()
  })

  it('eventTime 与 deadline 用同一套归一', async () => {
    stubLlm({ eventTime: { date: '2026-11-04T09:00:00+08:00', precision: 'datetime' } })
    expect((await extractStructured('t', 'c')).fields.eventTime).toEqual({
      date: '2026-11-04T09:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai'
    })
  })
})

describe('其余字段与元信息', () => {
  it('title 空白归一为 undefined', async () => {
    stubLlm({ title: '   ', confidence: 0.9 })
    expect((await extractStructured('t', 'c')).fields.title).toBeUndefined()
    stubLlm({ title: '有效标题', confidence: 0.9 })
    expect((await extractStructured('t', 'c')).fields.title).toBe('有效标题')
  })

  it('location / targetAudience 保留字符串', async () => {
    stubLlm({ location: '图书馆报告厅', targetAudience: '大一至大三' })
    const f = (await extractStructured('t', 'c')).fields
    expect(f.location).toBe('图书馆报告厅')
    expect(f.targetAudience).toBe('大一至大三')
  })

  it('model 取 LLM_MODEL 环境变量，缺省 deepseek-chat', async () => {
    stubLlm({})
    expect((await extractStructured('t', 'c')).model).toBe('deepseek-chat')
    env.LLM_MODEL = 'gpt-x'
    expect((await extractStructured('t', 'c')).model).toBe('gpt-x')
  })

  it('extractedAt 为 ISO 时间串', async () => {
    stubLlm({})
    expect((await extractStructured('t', 'c')).extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('错误路径', () => {
  it('未配置 LLM_API_KEY 抛错', async () => {
    delete env.LLM_API_KEY
    stubLlm({})
    await expect(extractStructured('t', 'c')).rejects.toThrow(/LLM_API_KEY/)
  })

  it('HTTP 非 2xx 抛错', async () => {
    stubLlm({}, false)
    await expect(extractStructured('t', 'c')).rejects.toThrow(/LLM 调用失败/)
  })

  it('LLM 返回非 JSON 抛错', async () => {
    stubLlm('这不是 JSON')
    await expect(extractStructured('t', 'c')).rejects.toThrow(/非 JSON/)
  })

  it('请求体只送必要字段，正文截断到 6000 字符', async () => {
    const spy = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }] })
    }))
    vi.stubGlobal('fetch', spy)
    await extractStructured('标题', 'x'.repeat(10000))

    const rawBody = spy.mock.calls[0]?.[1]?.body ?? '{}'
    const body = JSON.parse(String(rawBody)) as {
      messages: Array<{ role: string; content: string }>
      temperature: number
      response_format: { type: string }
    }
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMsg).toContain('标题')
    // 正文被截断到 6000 字符
    expect(userMsg).not.toContain('x'.repeat(6001))
    expect(body.temperature).toBe(0)
    expect(body.response_format.type).toBe('json_object')
  })
})
