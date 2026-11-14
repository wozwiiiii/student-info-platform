/**
 * job-ai-extract：AI 结构化管线（spec B4，定时触发器每 10 分钟）
 * 流程：collected 条目 →（必要时抓原文）→ LLM 提取 → aiExtract 落库
 *       → confidence ≥ 阈值转 pending_review，否则 low_confidence 强制人工（AGENT.md §4.3 / R12）
 * AI 输出永不直接发布；发布前关键字段（截止日期）仍需人工复核（发布门禁在 api-admin）
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { nowIso, type InfoDoc } from '../../lib/doc'
import { fetchText, stripTags } from '../../lib/html'
import { extractStructured, AI_LOW_CONFIDENCE_THRESHOLD } from '../../lib/llm'
import { canTransition } from '../../../shared/domain'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const INFORMATION = 'information'

const BATCH_SIZE = 10

async function processCollected(): Promise<unknown> {
  const res = await db.collection(INFORMATION)
    .where({ reviewStatus: 'collected' })
    .orderBy('createdAt', 'asc')
    .limit(BATCH_SIZE)
    .get<InfoDoc>()

  let processed = 0
  let failed = 0
  for (const doc of res.data) {
    if (!doc._id) continue
    try {
      let content = doc.content ?? ''
      if (!content && doc.sourceUrl) {
        content = stripTags(await fetchText(doc.sourceUrl)).slice(0, 6000)
      }
      const extraction = await extractStructured(doc.title, content)

      const target = extraction.confidence >= AI_LOW_CONFIDENCE_THRESHOLD ? 'pending_review' : 'low_confidence'
      // 语义上经历 collected → ai_extracted → target，两条迁移都合法才写入
      if (!canTransition(doc.reviewStatus, 'ai_extracted') || !canTransition('ai_extracted', target)) {
        throw new Error(`非法状态迁移: ${doc.reviewStatus} → ${target}`)
      }

      const patch: Record<string, unknown> = {
        aiExtract: extraction,
        reviewStatus: target,
        updatedAt: nowIso()
      }
      if (content && !doc.content) patch.content = content
      // AI 提取的类别/时间作为建议字段保留在 aiExtract，主字段以人工复核为准（不动 category/deadline 主字段）
      await db.collection(INFORMATION).doc(doc._id).update(patch)
      processed++
    } catch (error) {
      failed++
      logError(`job-ai-extract:${doc._id}`, error)
    }
  }
  return ok({ processed, failed, total: res.data.length })
}

export async function main(event: { action?: string; payload?: Record<string, unknown> }): Promise<unknown> {
  try {
    switch (event?.action) {
      case 'extract.pending':
      case undefined:
        return await processCollected()
      case 'extract.raw': {
        // 单条即时提取（管理后台辅助录入用），只返回不落库
        const title = String(event.payload?.title ?? '')
        const content = String(event.payload?.content ?? '')
        if (!title && !content) return fail(400, '缺少 title/content')
        return ok(await extractStructured(title, content))
      }
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('job-ai-extract', error)
    return fail(500, '服务内部错误')
  }
}
