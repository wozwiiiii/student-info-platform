/**
 * job-crawl：官网公开公告定时爬取（spec B2，每小时，R10 低频限公开页面）
 * 流程：source 集合（monitorMethod=scheduled_crawl）→ 抓列表页 → 关键词过滤链接
 *       → 去重入库 collected（AI 结构化管线接手）→ 可靠性留痕；失败告警走后台，人工补录兜底
 * 【客观事实】只解析静态 HTML；JS 渲染页面与公众号监控属于本机 tools/ 半自动方案（R9）
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { nowIso, type InfoDoc } from '../../lib/doc'
import { extractLinks, fetchText } from '../../lib/html'
import { CRAWL_KEYWORDS, classifyByTitle } from '../../lib/classify'
import { computeContentHash } from '../../../shared/domain'
import type { Source } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const INFORMATION = 'information'
const SOURCES = 'source'

const MAX_LINKS_PER_SOURCE = 10

type SourceDoc = Omit<Source, 'id'> & { _id?: string }

async function crawlOne(source: SourceDoc): Promise<{ added: number; failed: boolean }> {
  const url = source.homepageUrl
  if (!url || !source._id) return { added: 0, failed: true }

  try {
    const html = await fetchText(url)
    const links = extractLinks(html, url).filter((l) => CRAWL_KEYWORDS.test(l.text)).slice(0, MAX_LINKS_PER_SOURCE)

    let added = 0
    for (const link of links) {
      const contentHash = computeContentHash(link.text, source.name || link.url)
      const dup = await db.collection(INFORMATION).where({ contentHash }).limit(1).get<InfoDoc>()
      if (dup.data.length > 0) continue

      const { category, subType } = classifyByTitle(link.text)
      const doc: InfoDoc = {
        title: link.text,
        category,
        subType,
        deadlineVerifiedByHuman: false,
        sourceUrl: link.url,
        sourceChannel: source.name,
        sourceType: 'official_site',
        contentHash,
        reviewStatus: 'collected',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      await db.collection(INFORMATION).add(doc as unknown as Record<string, unknown>)
      added++
    }

    await db.collection(SOURCES).doc(source._id).update({
      lastFetchedAt: nowIso(),
      reliability: Math.min(1, (source.reliability ?? 0.5) + 0.02),
      updatedAt: nowIso()
    })
    return { added, failed: false }
  } catch (error) {
    logError(`job-crawl:${source.name}`, error)
    await db.collection(SOURCES).doc(source._id).update({
      reliability: Math.max(0, (source.reliability ?? 0.5) - 0.1),
      updatedAt: nowIso()
    })
    return { added: 0, failed: true }
  }
}

async function runCrawl(): Promise<unknown> {
  const res = await db.collection(SOURCES)
    .where({ monitorMethod: 'scheduled_crawl' })
    .limit(20)
    .get<SourceDoc>()

  let added = 0
  let failedSources = 0
  for (const source of res.data) {
    const r = await crawlOne(source)
    added += r.added
    if (r.failed) failedSources++
  }
  return ok({ sources: res.data.length, added, failedSources })
}

export async function main(event: { action?: string }): Promise<unknown> {
  try {
    switch (event?.action) {
      case 'crawl.run':
      case undefined:
        return await runCrawl()
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('job-crawl', error)
    return fail(500, '服务内部错误')
  }
}
