/**
 * api-admin：管理端录入/审核/更新（spec B3 + 审核机制，AGENT.md §3.3/§4.3/§4.4）
 * 契约：event = { action, payload }，返回 { code, message, data }
 *  - info.create     payload: InformationCreateInput（zod 校验 + contentHash 去重幂等）
 *  - info.listAdmin  payload: { status?, category?, page?, pageSize? }
 *  - info.review     payload: { id, action: 'publish'|'reject'|'correct', deadlineVerifiedByHuman? }
 *  - info.update     payload: { id, patch }
 *  - info.import     payload: { items: InformationCreateInput[] }（B1 监控产物一键导入，逐条校验+去重）
 *  - roadmap.create  payload: RoadmapNodeCreateInput（R8：lastMaintainedAt 必填）
 *  - roadmap.update  payload: { id, patch }（内容字段变更自动刷新 lastMaintainedAt）
 *  - roadmap.listAdmin payload: 无（返回全部节点，待维护判定由调用方用 shared/domain 的 isNodeStale）
 *  - metrics.dashboard 无需 payload：数据看板 KPI 快照（M5，口径见 shared/domain/metrics）
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { informationCreateSchema, informationPatchSchema, roadmapNodeCreateSchema, roadmapNodeUpdateSchema } from '../../../shared/schemas'
import {
  buildMetricsSnapshot, canTransition, checkPublishable, computeContentHash, expectTransition,
  shanghaiDateOf, todayShanghaiDate
} from '../../../shared/domain'
import type { Information, MetricsSnapshot, ReviewStatus, RoadmapNode } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTION = 'information'
const REVIEW_LOG = 'review_log'

type InfoDoc = Omit<Information, 'id'> & { _id?: string }
type AdminAction = 'publish' | 'reject' | 'correct'

const ACTION_TO_STATUS: Record<AdminAction, ReviewStatus> = {
  publish: 'published',
  reject: 'rejected',
  correct: 'corrected'
}

const UPDATABLE_FIELDS = [
  'title', 'category', 'subType', 'summary', 'content', 'deadline',
  'eventTime', 'location', 'targetAudience', 'sourceUrl', 'sourceChannel', 'sourceType'
] as const

function nowIso(): string {
  return new Date().toISOString()
}

/** Asia/Shanghai 当天日期（lastMaintainedAt 自动刷新用）；口径统一收在 shared/domain/date */
const todayIsoDate = (): string => todayShanghaiDate()

type InfoCreateInput = ReturnType<typeof informationCreateSchema.parse>

/**
 * 幂等落库（AGENT.md §4.5）：contentHash 重复返回既有条目而非报错。
 *
 * 整改 SN-24：原实现是「先查后写」，并发下两次都查不到重复；若 contentHash 建了唯一索引，
 * 第二次 add 会抛异常被外层吞成 500，也不符合「返回既有条目而非报错」。
 * 现改为：写入失败时回查 contentHash，命中即视为重复返回既有条目。
 */
async function insertUniqueInfo(input: InfoCreateInput): Promise<{ id: string; duplicate: boolean }> {
  const contentHash = computeContentHash(input.title, input.sourceChannel || input.sourceUrl)
  const findExisting = async (): Promise<InfoDoc | undefined> =>
    (await db.collection(COLLECTION).where({ contentHash }).limit(1).get<InfoDoc>()).data[0]

  const existing = await findExisting()
  if (existing) {
    return { id: existing._id ?? '', duplicate: true }
  }

  const doc: InfoDoc = {
    ...input,
    sourceUrl: input.sourceUrl ?? '',
    sourceChannel: input.sourceChannel ?? '',
    // 整改 SN-01：写入侧一律 false，「已人工复核」只能由 info.review 审核动作设置（§4.3 / R12）
    deadlineVerifiedByHuman: false,
    contentHash,
    reviewStatus: 'pending_review',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  try {
    const added = await db.collection(COLLECTION).add(doc as unknown as Record<string, unknown>)
    return { id: added._id, duplicate: false }
  } catch (error) {
    // 并发/唯一索引冲突：回查既有条目，命中则幂等返回（§4.5）
    const raced = await findExisting()
    if (raced) return { id: raced._id ?? '', duplicate: true }
    throw error
  }
}

async function createInfo(raw: Record<string, unknown>): Promise<unknown> {
  const parsed = informationCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  return ok(await insertUniqueInfo(parsed.data))
}

/**
 * B1 监控产物一键导入：逐条 zod 校验 + contentHash 去重，全部落为 pending_review。
 * 写入侧强制 deadlineVerifiedByHuman=false（无人工复核动作，发布门禁仍会拦截）。
 *
 * 整改 SN-43：原实现在中途写入异常时直接抛到外层变成 500，已写入的条目不回滚，
 * 调用方无从得知「已导入多少」。现改为逐条捕获，把失败条目并入 invalid 明细返回，
 * 让调用方能据实重试（重试会因 contentHash 去重而跳过已导入项，天然幂等）。
 */
async function importInfos(raw: Record<string, unknown>): Promise<unknown> {
  const items = raw.items
  if (!Array.isArray(items) || items.length === 0) return fail(400, 'items 必须为非空数组')
  if (items.length > 100) return fail(400, '单次导入上限 100 条')

  let imported = 0
  let duplicates = 0
  const invalid: Array<{ index: number; reason: string }> = []
  for (let i = 0; i < items.length; i++) {
    const parsed = informationCreateSchema.safeParse(items[i])
    if (!parsed.success) {
      invalid.push({ index: i, reason: parsed.error.issues.map((iss) => `${iss.path.join('.')}:${iss.message}`).join('; ') })
      continue
    }
    try {
      const result = await insertUniqueInfo(parsed.data)
      if (result.duplicate) duplicates++
      else imported++
    } catch (error) {
      invalid.push({ index: i, reason: `写入失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return ok({ imported, duplicates, invalid })
}

async function listAdmin(raw: Record<string, unknown>): Promise<unknown> {
  const page = Math.max(1, Math.floor(Number(raw.page ?? 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(raw.pageSize ?? 20))))
  const where: Record<string, unknown> = {}
  if (raw.status) where.reviewStatus = raw.status
  if (raw.category) where.category = raw.category

  const coll = db.collection(COLLECTION)
  const [listRes, countRes] = await Promise.all([
    coll.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get<InfoDoc>(),
    coll.where(where).count()
  ])
  return ok({ items: listRes.data.map(({ _id, ...rest }) => ({ id: _id, ...rest })), total: countRes.total, page, pageSize })
}

async function reviewInfo(raw: Record<string, unknown>): Promise<unknown> {
  const id = String(raw.id ?? '')
  // 整改 SN-20：`in` 会查原型链，'toString'/'constructor' 能通过守卫并取到 Object.prototype
  // 上的方法，最终以 409「非法状态迁移」而非 400 返回。改用自有属性判断。
  const action = raw.action as AdminAction
  if (!id || !Object.prototype.hasOwnProperty.call(ACTION_TO_STATUS, action)) {
    return fail(400, '缺少 id 或 action 非法')
  }

  const coll = db.collection(COLLECTION)
  const res = await coll.doc(id).get<InfoDoc>()
  const doc = res.data
  if (!doc) return fail(404, '信息不存在')

  const target = ACTION_TO_STATUS[action]
  if (!canTransition(doc.reviewStatus, target)) {
    return fail(409, `非法状态迁移: ${doc.reviewStatus} → ${target}`)
  }

  const deadlineVerifiedByHuman =
    typeof raw.deadlineVerifiedByHuman === 'boolean' ? raw.deadlineVerifiedByHuman : doc.deadlineVerifiedByHuman

  if (target === 'published') {
    // 发布门禁（AGENT.md §4.4 / R12）：来源必有；deadline 必须人工复核
    const gate = checkPublishable({
      sourceUrl: doc.sourceUrl ?? '',
      sourceChannel: doc.sourceChannel ?? '',
      deadline: doc.deadline,
      deadlineVerifiedByHuman
    })
    if (!gate.ok) return fail(409, gate.reason === 'missing_source' ? '缺少来源，禁止发布' : '截止日期未经人工复核，禁止发布')
    expectTransition(doc.reviewStatus, target)
  }

  const updatedAt = nowIso()
  await coll.doc(id).update({
    reviewStatus: target,
    deadlineVerifiedByHuman,
    ...(target === 'published' ? { publishedAt: updatedAt } : {}),
    updatedAt
  })
  // 整改 SN-21：§3.3 要求 review_log 含 diff 以便全链路追溯，此前只有 fromStatus。
  await db.collection(REVIEW_LOG).add({
    infoId: id,
    operator: 'admin',
    action: target,
    fromStatus: doc.reviewStatus,
    diff: {
      reviewStatus: { from: doc.reviewStatus, to: target },
      deadlineVerifiedByHuman: { from: doc.deadlineVerifiedByHuman ?? false, to: deadlineVerifiedByHuman }
    },
    at: updatedAt
  })
  return ok({ id, reviewStatus: target })
}

/**
 * 信息更新（info.update）。
 *
 * 整改 SN-17/SN-18/SN-19：原实现只做 UPDATABLE_FIELDS 白名单复制，对值不作任何校验、
 * 也不复跑发布门禁，一个入口带出三个高危问题。现补齐三条硬约束：
 *  - SN-17：patch 逐字段过 informationPatchSchema（§4.2 所有对外写操作必须过 zod）；
 *  - SN-18：更新后 sourceUrl 与 sourceChannel 仍须至少一个非空（§4.4 不做无来源信息），
 *           否则已发布条目可被清空来源而仍保持 published；
 *  - SN-19：修改 deadline 会把 deadlineVerifiedByHuman 重置为 false（§4.3 / R12）——
 *           复核标记是对「某个具体 deadline 值」的背书，改期后旧背书不得沿用。
 */
async function updateInfo(raw: Record<string, unknown>): Promise<unknown> {
  const id = String(raw.id ?? '')
  const rawPatch = (raw.patch ?? {}) as Record<string, unknown>
  if (!id) return fail(400, '缺少 id')

  // 只保留契约内字段，再逐字段校验
  const candidate: Record<string, unknown> = {}
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawPatch, key)) candidate[key] = rawPatch[key]
  }
  if (Object.keys(candidate).length === 0) return fail(400, '无可更新字段')

  const parsed = informationPatchSchema.safeParse(candidate)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const patch2: Record<string, unknown> = { ...parsed.data }

  const doc = (await db.collection(COLLECTION).doc(id).get<InfoDoc>()).data
  if (!doc) return fail(404, '信息不存在')

  // SN-18：更新后来源不得双双为空
  const nextSourceUrl = String(patch2.sourceUrl ?? doc.sourceUrl ?? '')
  const nextSourceChannel = String(patch2.sourceChannel ?? doc.sourceChannel ?? '')
  if (!nextSourceUrl.trim() && !nextSourceChannel.trim()) {
    return fail(409, 'sourceUrl 与 sourceChannel 不能同时为空（不做无来源信息）')
  }

  // SN-19：deadline 变更则复核标记失效
  const deadlineChanged = Object.prototype.hasOwnProperty.call(patch2, 'deadline')
  if (deadlineChanged) {
    patch2.deadlineVerifiedByHuman = false
  }

  if ('title' in patch2 || 'sourceChannel' in patch2) {
    const title = String(patch2.title ?? doc.title ?? '')
    patch2.contentHash = computeContentHash(title, nextSourceChannel || nextSourceUrl)
  }
  const updatedAt = nowIso()
  patch2.updatedAt = updatedAt
  await db.collection(COLLECTION).doc(id).update(patch2)

  // SN-21：纠错/修改留痕，记录字段级 diff 供追溯（§3.3 review_log | ... | diff）
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, value] of Object.entries(patch2)) {
    if (key === 'updatedAt') continue
    diff[key] = { from: (doc as unknown as Record<string, unknown>)[key], to: value }
  }
  await db.collection(REVIEW_LOG).add({
    infoId: id,
    operator: 'admin',
    action: 'updated',
    fromStatus: doc.reviewStatus,
    diff,
    at: updatedAt
  })
  return ok({ id })
}

type RoadmapDoc = Omit<RoadmapNode, 'id'> & { _id?: string }
type RoadmapCreateInput = ReturnType<typeof roadmapNodeCreateSchema.parse>

/** 内容字段（编辑即视为整理，自动刷新 lastMaintainedAt，R8） */
const ROADMAP_CONTENT_FIELDS = [
  'year', 'semester', 'title', 'description', 'typicalWindow', 'relatedCategory', 'relatedInfoIds'
] as const

async function createRoadmapNode(raw: Record<string, unknown>): Promise<unknown> {
  const parsed = roadmapNodeCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const input: RoadmapCreateInput = parsed.data
  const doc: RoadmapDoc = {
    ...input,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  const added = await db.collection('roadmap_node').add(doc as unknown as Record<string, unknown>)
  return ok({ id: added._id })
}

async function updateRoadmapNode(raw: Record<string, unknown>): Promise<unknown> {
  const id = String(raw.id ?? '')
  const patch = (raw.patch ?? {}) as Record<string, unknown>
  if (!id) return fail(400, '缺少 id')

  const parsed = roadmapNodeUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const validPatch = parsed.data as Record<string, unknown>
  if (Object.keys(validPatch).length === 0) return fail(400, '无可更新字段')

  // 整改 SN-44：节点不存在须报 404，不能静默返回 ok 让调用方误以为改成功
  const existing = (await db.collection('roadmap_node').doc(id).get<RoadmapDoc>()).data
  if (!existing) return fail(404, '路线图节点不存在')

  // R8：内容字段变更视为一次整理，自动刷新 lastMaintainedAt（显式传入则以传入为准）
  const touchedContent = ROADMAP_CONTENT_FIELDS.some((f) => f in validPatch)
  if (touchedContent && !('lastMaintainedAt' in validPatch)) {
    validPatch.lastMaintainedAt = todayIsoDate()
  }
  validPatch.updatedAt = nowIso()
  await db.collection('roadmap_node').doc(id).update(validPatch)
  return ok({ id })
}

async function listRoadmapAdmin(): Promise<unknown> {
  const res = await db.collection('roadmap_node').where({}).limit(200).get<RoadmapDoc>()
  const items = res.data.map(({ _id, ...rest }) => ({ id: _id, ...rest }))
  return ok({ items, total: items.length })
}

type ActivityDoc = { openId: string; date: string }
type SubscribeScanDoc = { openId: string; quota?: number; expireAt?: string }
type SubmissionScanDoc = { createdAt?: string }

/**
 * 数据看板（M5）：原始计数聚合 + shared 口径计算。
 * 单校试点规模假设：各集合 ≤ 数千条，扫描聚合足够（如需扩展再建日聚合表）。
 */
async function metricsDashboard(): Promise<unknown> {
  const now = Date.now()
  // Asia/Shanghai 日期（周活/投稿按天口径：近 7 天含今天）；口径收在 shared/domain/date
  const today = todayShanghaiDate(new Date(now))
  const cutoffDate = todayShanghaiDate(new Date(now - 6 * 24 * 60 * 60 * 1000))

  const [
    activityRes, userCount, subRes,
    pushedCount, opensCount,
    submissionsCount, submissionsRes,
    correctedCount, publishedCount
  ] = await Promise.all([
    db.collection('activity_log').where({}).limit(5000).get<ActivityDoc>(),
    db.collection('user').where({}).count(),
    db.collection('subscribe_record').where({}).limit(2000).get<SubscribeScanDoc>(),
    db.collection('reminder_log').where({ status: 'sent' }).count(),
    db.collection('event_log').where({ type: 'open_remind' }).count(),
    db.collection('submission').where({}).count(),
    db.collection('submission').where({}).limit(2000).get<SubmissionScanDoc>(),
    db.collection('review_log').where({ action: 'corrected' }).count(),
    db.collection('review_log').where({ action: 'published' }).count()
  ])

  const weeklyActiveUsers = new Set(
    activityRes.data.filter((a) => a.date >= cutoffDate && a.date <= today).map((a) => a.openId)
  ).size
  const reachableSubscribers = new Set(
    subRes.data
      .filter((r) => (r.quota ?? 0) > 0 && (!r.expireAt || new Date(r.expireAt).getTime() > now))
      .map((r) => r.openId)
  ).size
  // 整改 SN-42：createdAt 是 UTC ISO 串，直接 slice(0,10) 得到 UTC 日期，
  // 与 Asia/Shanghai 推导的 today/cutoffDate 混用会让每天 00:00–08:00 的投稿漏统计。
  // 统一换算成 Asia/Shanghai 日期再比较（与 activity_log.date 口径一致）。
  const submissions7d = submissionsRes.data
    .filter((s) => {
      if (!s.createdAt) return false
      const d = shanghaiDateOf(s.createdAt)
      return d >= cutoffDate && d <= today
    })
    .length

  const snapshot: MetricsSnapshot = {
    ...buildMetricsSnapshot({
      weeklyActiveUsers,
      totalUsers: userCount.total,
      reachableSubscribers,
      reminderPushed: pushedCount.total,
      reminderOpens: opensCount.total,
      submissionsTotal: submissionsCount.total,
      submissions7d,
      corrections: correctedCount.total,
      publishes: publishedCount.total
    }),
    computedAt: nowIso()
  }
  return ok(snapshot)
}

export async function main(event: {
  action?: string
  payload?: Record<string, unknown>
}): Promise<unknown> {
  try {
    const raw = event?.payload ?? {}
    switch (event?.action) {
      case 'info.create':
        return await createInfo(raw)
      case 'info.listAdmin':
        return await listAdmin(raw)
      case 'info.review':
        return await reviewInfo(raw)
      case 'info.update':
        return await updateInfo(raw)
      case 'info.import':
        return await importInfos(raw)
      case 'roadmap.create':
        return await createRoadmapNode(raw)
      case 'roadmap.update':
        return await updateRoadmapNode(raw)
      case 'roadmap.listAdmin':
        return await listRoadmapAdmin()
      case 'metrics.dashboard':
        return await metricsDashboard()
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('api-admin', error)
    return fail(500, '服务内部错误')
  }
}
