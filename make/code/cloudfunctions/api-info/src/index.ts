/**
 * api-info：公开信息读取（小程序信息流 A1 / 分类频道 A2 / Deadline 日历 A3 / 路线图 A4）
 * 只返回 reviewStatus=published 的条目（审核后发布底线，AGENT.md §4.3）
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import type { InfoDoc } from '../../lib/doc'
import { getDeadlineInstant, groupNodesByYearSemester } from '../../../shared/domain'
import type { ApiResult, Information, RoadmapNode, RoadmapNodeWithInfos } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTION = 'information'

interface ListPayload {
  category?: string
  subType?: string
  page?: number
  pageSize?: number
}

interface DeadlinePayload {
  /** 只返回 N 天内截止的条目（默认 30，上限 180） */
  withinDays?: number
}

/** 云文档 _id → 契约字段 id（Information.id） */
function toInfo({ _id, ...rest }: InfoDoc): Information {
  return { id: _id ?? '', ...(rest as Omit<Information, 'id'>) }
}

async function listPublished(payload: ListPayload): Promise<ApiResult<unknown>> {
  const page = Math.max(1, Math.floor(payload.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(payload.pageSize ?? 20)))
  const where: Record<string, unknown> = { reviewStatus: 'published' }
  if (payload.category) where.category = payload.category
  if (payload.subType) where.subType = payload.subType

  const coll = db.collection(COLLECTION)
  const [listRes, countRes] = await Promise.all([
    coll.where(where).orderBy('publishedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get<InfoDoc>(),
    coll.where(where).count()
  ])
  return ok({ items: listRes.data.map(toInfo), total: countRes.total, page, pageSize })
}

async function getPublished(id: string): Promise<ApiResult<unknown>> {
  if (!id) return fail(400, '缺少 id')
  try {
    const res = await db.collection(COLLECTION).doc(id).get<InfoDoc>()
    const info = res.data
    if (!info || info.reviewStatus !== 'published') {
      return fail(404, '信息不存在或未发布')
    }
    return ok(toInfo(info))
  } catch {
    return fail(404, '信息不存在或未发布')
  }
}

/** Deadline 日历（A3）：未来 N 天内截止的 published 条目，按截止时刻升序 */
async function listDeadlines(payload: DeadlinePayload): Promise<ApiResult<unknown>> {
  const withinDays = Math.min(180, Math.max(1, Math.floor(payload.withinDays ?? 30)))
  const now = Date.now()
  const until = now + withinDays * 24 * 60 * 60 * 1000

  // 单校试点规模假设：published ≤ 200/批，内存过滤排序足够
  const res = await db.collection(COLLECTION)
    .where({ reviewStatus: 'published' })
    .orderBy('publishedAt', 'desc')
    .limit(200)
    .get<InfoDoc>()

  const items = res.data
    .filter((d) => {
      if (!d.deadline) return false
      const t = getDeadlineInstant(d.deadline).getTime()
      return t >= now && t <= until
    })
    .sort((a, b) => getDeadlineInstant(a.deadline as NonNullable<InfoDoc['deadline']>).getTime()
      - getDeadlineInstant(b.deadline as NonNullable<InfoDoc['deadline']>).getTime())
    .slice(0, 100)
    .map(toInfo)
  return ok({ items, total: items.length, withinDays })
}

type RoadmapDoc = Omit<RoadmapNode, 'id'> & { _id?: string }

/** 路线图（A4）：全部节点按「学年+学期」排序，节点内嵌关联的已发布实时信息（R8：lastMaintainedAt 随节点返回） */
async function listRoadmap(): Promise<ApiResult<unknown>> {
  const [nodeRes, infoRes] = await Promise.all([
    db.collection('roadmap_node').where({}).limit(100).get<RoadmapDoc>(),
    db.collection(COLLECTION)
      .where({ reviewStatus: 'published' })
      .orderBy('publishedAt', 'desc')
      .limit(200)
      .get<InfoDoc>()
  ])

  const publishedInfos = infoRes.data.map(toInfo)
  const nodes = nodeRes.data.map(({ _id, ...rest }): RoadmapNodeWithInfos => ({
    id: _id ?? '',
    ...rest,
    // 单校试点规模假设：published ≤ 200，内存关联足够
    relatedInfos: publishedInfos.filter((i) => (rest.relatedInfoIds ?? []).includes(i.id))
  }))

  // 展示顺序由 shared 领域函数统一提供（禁止前端各自排序）
  const items = groupNodesByYearSemester(nodes).flatMap((g) => g.nodes)
  return ok({ items, total: items.length })
}

export async function main(event: {
  action?: string
  payload?: Record<string, unknown>
}): Promise<ApiResult<unknown>> {
  try {
    const payload = event?.payload ?? {}
    switch (event?.action) {
      case 'info.list':
        return await listPublished(payload as ListPayload)
      case 'info.get':
        return await getPublished(String(payload.id ?? ''))
      case 'info.deadlines':
        return await listDeadlines(payload as DeadlinePayload)
      case 'roadmap.list':
        return await listRoadmap()
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('api-info', error)
    return fail(500, '服务内部错误')
  }
}
