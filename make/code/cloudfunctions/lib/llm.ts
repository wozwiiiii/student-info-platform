/**
 * LLMProvider（AGENT.md §2.1：OpenAI 兼容接口，可换供应商）
 * 配置走环境变量：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 * 输出永不直接发布（AGENT.md §4.3）：本模块只产出 AiExtraction，状态由审核状态机流转
 */
import type { AiExtraction, InfoCategory, InfoSubType } from '../../shared/types'
import { AI_LOW_CONFIDENCE_THRESHOLD } from '../../shared/domain'

const CATEGORY_MAP: Record<string, InfoCategory> = {
  opportunity: 'opportunity', scholarship: 'scholarship', academic: 'academic', lecture: 'lecture',
  机会成长: 'opportunity', 奖助评优: 'scholarship', 教务通知: 'academic', 讲座活动: 'lecture'
}
const SUBTYPE_MAP: Record<string, InfoSubType> = {
  competition: 'competition', job_internship: 'job_internship', postgrad: 'postgrad', other: 'other',
  竞赛: 'competition', 就业实习: 'job_internship', 保研: 'postgrad', 其他: 'other'
}

const SYSTEM_PROMPT = [
  '你是高校信息结构化助手。从用户给出的校园通知原文中提取字段，只输出 JSON，不要输出其他文字。',
  'JSON 结构：{"title":string,"category":"opportunity|scholarship|academic|lecture",',
  '"subType":"competition|job_internship|postgrad|other|null",',
  '"deadline":{"date":"YYYY-MM-DD 或 ISO 时间","precision":"date|datetime"}|null,',
  '"eventTime":同 deadline 结构|null,"location":string|null,"targetAudience":string|null,',
  '"confidence":0到1的数字}',
  'deadline 指报名/提交/申请的截止时间（不是发布时间）；category 语义：opportunity=机会成长(竞赛/就业/保研)、scholarship=奖助评优、academic=教务通知、lecture=讲座活动；confidence 表示你对整体提取结果的把握。'
].join('\n')

function toDeadline(raw: unknown): AiExtraction['fields']['deadline'] {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as { date?: unknown; precision?: unknown }
  const date = typeof d.date === 'string' ? d.date.trim() : ''
  if (!date || Number.isNaN(new Date(date).getTime())) return undefined
  const precision = d.precision === 'datetime' ? 'datetime' : 'date'
  return { date, precision, tz: 'Asia/Shanghai' }
}

function getEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
}

export async function extractStructured(title: string, content: string): Promise<AiExtraction> {
  const env = getEnv()
  const baseUrl = env.LLM_BASE_URL || 'https://api.deepseek.com'
  const apiKey = env.LLM_API_KEY
  const model = env.LLM_MODEL || 'deepseek-chat'
  if (!apiKey) throw new Error('未配置 LLM_API_KEY 环境变量')

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `标题：${title}\n\n正文：${content.slice(0, 6000)}` }
      ]
    })
  })
  if (!res.ok) throw new Error(`LLM 调用失败 HTTP ${res.status}`)
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = body.choices?.[0]?.message?.content ?? ''
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('LLM 返回非 JSON')
  }

  const category = typeof parsed.category === 'string' ? CATEGORY_MAP[parsed.category.trim()] : undefined
  const subType = typeof parsed.subType === 'string' ? SUBTYPE_MAP[parsed.subType.trim()] : undefined
  const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  const confidence = Math.min(1, Math.max(0, rawConfidence))

  return {
    fields: {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined,
      category,
      subType,
      deadline: toDeadline(parsed.deadline),
      eventTime: toDeadline(parsed.eventTime),
      location: typeof parsed.location === 'string' ? parsed.location : undefined,
      targetAudience: typeof parsed.targetAudience === 'string' ? parsed.targetAudience : undefined
    },
    confidence,
    model,
    extractedAt: new Date().toISOString()
  }
}

export { AI_LOW_CONFIDENCE_THRESHOLD }
