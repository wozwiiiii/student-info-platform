/**
 * api-submission：众包投稿（spec B5）
 * 契约：event = { action, payload }，返回 { code, message, data }
 *  - submission.create     payload: { url, sourceChannel?, note? }（小程序端，OPENID 自动取）
 *  - submission.listAdmin  payload: { status?, page?, pageSize? }
 *  - submission.review     payload: { id, action: 'accept'|'reject'|'duplicate' }
 * AI 预审仅出建议；accept 时抓取原文入库 collected，由 AI 结构化管线接手（人工确认后才可发布）
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { nowIso, type InfoDoc } from '../../lib/doc'
import { extractTitle, fetchText, stripTags } from '../../lib/html'
import { classifyByTitle } from '../../lib/classify'
import { submissionCreateSchema } from '../../../shared/schemas'
import { computeContentHash } from '../../../shared/domain'
import type { Submission } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const SUBMISSIONS = 'submission'
const INFORMATION = 'information'

type SubmissionDoc = Omit<Submission, 'id'> & { _id?: string }

async function createSubmission(raw: Record<string, unknown>): Promise<unknown> {
  const parsed = submissionCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const { url, sourceChannel, note } = parsed.data

  // 幂等：同链接重复投稿返回既有记录（AGENT.md §4.5）
  const dup = await db.collection(SUBMISSIONS).where({ url }).limit(1).get<SubmissionDoc>()
  const existing = dup.data[0]
  if (existing) return ok({ id: existing._id, duplicate: true, status: existing.status })

  const doc: SubmissionDoc = {
    submitterOpenId: cloud.getWXContext().OPENID ?? '',
    url,
    sourceChannel,
    note,
    aiPreReview: {
      legalSource: /^https?:\/\//.test(url),
      confidence: 0.5
    },
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  const added = await db.collection(SUBMISSIONS).add(doc as unknown as Record<string, unknown>)
  return ok({ id: added._id, duplicate: false, status: 'pending' })
}

async function listSubmissions(raw: Record<string, unknown>): Promise<unknown> {
  const page = Math.max(1, Math.floor(Number(raw.page ?? 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(raw.pageSize ?? 20))))
  const where: Record<string, unknown> = {}
  if (raw.status) where.status = raw.status
  const coll = db.collection(SUBMISSIONS)
  const [listRes, countRes] = await Promise.all([
    coll.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get<SubmissionDoc>(),
    coll.where(where).count()
  ])
  return ok({ items: listRes.data.map(({ _id, ...rest }) => ({ id: _id, ...rest })), total: countRes.total, page, pageSize })
}

async function reviewSubmission(raw: Record<string, unknown>): Promise<unknown> {
  const id = String(raw.id ?? '')
  const action = String(raw.action ?? '')
  if (!id || !['accept', 'reject', 'duplicate'].includes(action)) return fail(400, '缺少 id 或 action 非法')

  const subColl = db.collection(SUBMISSIONS)
  const sub = (await subColl.doc(id).get<SubmissionDoc>()).data
  if (!sub) return fail(404, '投稿不存在')

  // 整改 SN-15：原实现无状态机校验也不做幂等，重复调用 accept 会重新抓取、重新查重，
  // 命中自己第一次入库的 information 后把状态从 accepted 改写成 duplicate（实测已复现）。
  // 已终态的投稿一律幂等返回，不再改写状态，也不再重复抓取。
  if (sub.status === 'accepted' || sub.status === 'rejected' || sub.status === 'duplicate') {
    return ok({ id, status: sub.status, alreadyReviewed: true })
  }

  const updatedAt = nowIso()
  // 整改 SN-16：action 是 'reject'（无 d），而 Submission['status'] 契约为 'rejected'，
  // 原实现直接 `update({ status: action })` 会写入契约外取值，按 'rejected' 过滤的查询查不到。
  if (action === 'reject' || action === 'duplicate') {
    const status = action === 'reject' ? 'rejected' : 'duplicate'
    await subColl.doc(id).update({ status, updatedAt })
    return ok({ id, status })
  }

  // accept：抓取原文入库（人工确认后进入采集态，绝不直接发布）
  let title: string
  let content: string
  try {
    const html = await fetchText(sub.url)
    title = extractTitle(html)
    content = stripTags(html).slice(0, 5000)
  } catch {
    return fail(422, '无法抓取原文，请改用管理后台人工补录')
  }
  if (!title) return fail(422, '无法提取页面标题，请改用管理后台人工补录')

  const sourceChannel = sub.sourceChannel ?? ''
  const contentHash = computeContentHash(title, sourceChannel || sub.url)
  const dupInfo = await db.collection(INFORMATION).where({ contentHash }).limit(1).get<InfoDoc>()
  const dupDoc = dupInfo.data[0]
  if (dupDoc) {
    await subColl.doc(id).update({ status: 'duplicate', updatedAt })
    return ok({ id, status: 'duplicate', infoId: dupDoc._id })
  }

  const { category, subType } = classifyByTitle(title)
  const infoDoc: InfoDoc = {
    title,
    category,
    subType,
    summary: content.slice(0, 200),
    content,
    deadlineVerifiedByHuman: false,
    sourceUrl: sub.url,
    sourceChannel,
    sourceType: 'user_submission',
    contentHash,
    reviewStatus: 'collected',
    createdAt: updatedAt,
    updatedAt
  }
  const added = await db.collection(INFORMATION).add(infoDoc as unknown as Record<string, unknown>)
  await subColl.doc(id).update({ status: 'accepted', updatedAt })
  return ok({ id, status: 'accepted', infoId: added._id })
}

export async function main(event: { action?: string; payload?: Record<string, unknown> }): Promise<unknown> {
  try {
    const raw = event?.payload ?? {}
    switch (event?.action) {
      case 'submission.create':
        return await createSubmission(raw)
      case 'submission.listAdmin':
        return await listSubmissions(raw)
      case 'submission.review':
        return await reviewSubmission(raw)
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('api-submission', error)
    return fail(500, '服务内部错误')
  }
}
