/**
 * 管理后台服务层：POST {VITE_API_BASE}/api-admin，body = { action, payload }
 * 契约（cloudfunctions/api-admin）：响应 { code, message, data }，code = 0 为成功。
 * 失败一律返回真实错误信息，禁止任何 mock/假数据兜底。
 */
import type { ApiResult } from '@shared/types/common'
import type { InfoCategory, Information, ReviewStatus } from '@shared/types/information'
import type { MetricsSnapshot } from '@shared/types/metrics'
import type { RoadmapNode } from '@shared/types/roadmap'
import type { InformationCreateInput } from '@shared/schemas/information'
import type { RoadmapNodeCreateInput, RoadmapNodeUpdateInput } from '@shared/schemas/roadmap'

export type ReviewAction = 'publish' | 'reject' | 'correct'

export interface InfoListQuery {
  status?: ReviewStatus | ''
  category?: InfoCategory | ''
  page: number
  pageSize: number
}

export interface InfoListData {
  items: Information[]
  total: number
  page: number
  pageSize: number
}

export interface CreateInfoData {
  id: string
  duplicate: boolean
}

export interface ReviewInput {
  id: string
  action: ReviewAction
  deadlineVerifiedByHuman?: boolean
}

export interface ReviewData {
  id: string
  reviewStatus: ReviewStatus
}

export interface ImportResultData {
  imported: number
  duplicates: number
  invalid: Array<{ index: number; reason: string }>
}

export interface RoadmapListData {
  items: RoadmapNode[]
  total: number
}

interface ApiEnvelope {
  code: number
  message: string
  data: unknown
}

function isApiEnvelope(body: unknown): body is ApiEnvelope {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return typeof b.code === 'number' && typeof b.message === 'string'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function callAdmin<T>(action: string, payload: unknown): Promise<ApiResult<T>> {
  const base = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')
  if (!base) {
    return { code: -1, message: '未配置 VITE_API_BASE（见 .env.development），无法请求 api-admin', data: null }
  }

  let res: Response
  try {
    res = await fetch(`${base}/api-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    })
  } catch (error) {
    return { code: -1, message: `网络请求失败：${errorMessage(error)}`, data: null }
  }

  let bodyText: string
  try {
    bodyText = await res.text()
  } catch (error) {
    return { code: -1, message: `读取响应失败：${errorMessage(error)}`, data: null }
  }

  if (!res.ok) {
    const detail = bodyText ? `：${bodyText.slice(0, 200)}` : ''
    return { code: res.status, message: `HTTP ${res.status} ${res.statusText}${detail}`, data: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    return { code: -1, message: `响应不是合法 JSON：${bodyText.slice(0, 200)}`, data: null }
  }

  if (!isApiEnvelope(parsed)) {
    return { code: -1, message: `响应不符合 { code, message, data } 契约：${bodyText.slice(0, 200)}`, data: null }
  }
  return { code: parsed.code, message: parsed.message, data: (parsed.data ?? null) as T | null }
}

/** 录入一条信息（提交前须过 shared 的 informationCreateSchema 校验） */
export function createInfo(input: InformationCreateInput): Promise<ApiResult<CreateInfoData>> {
  return callAdmin<CreateInfoData>('info.create', input)
}

/** 审核队列列表（状态过滤 + 分页） */
export function listAdmin(query: InfoListQuery): Promise<ApiResult<InfoListData>> {
  return callAdmin<InfoListData>('info.listAdmin', {
    status: query.status ? query.status : undefined,
    category: query.category ? query.category : undefined,
    page: query.page,
    pageSize: query.pageSize
  })
}

/** 审核操作：发布 / 驳回 / 纠错；发布时须带 deadlineVerifiedByHuman 复核结论 */
export function reviewInfo(input: ReviewInput): Promise<ApiResult<ReviewData>> {
  return callAdmin<ReviewData>('info.review', input)
}

/** B1 监控产物一键导入：逐条校验 + 去重，全部落为待审核（强制未人工复核） */
export function importInfos(items: InformationCreateInput[]): Promise<ApiResult<ImportResultData>> {
  return callAdmin<ImportResultData>('info.import', { items })
}

/** 路线图节点列表（A4 维护；待维护判定用 @shared/domain 的 isNodeStale，R8） */
export function listRoadmapNodes(): Promise<ApiResult<RoadmapListData>> {
  return callAdmin<RoadmapListData>('roadmap.listAdmin', {})
}

/** 新建路线图节点（lastMaintainedAt 必填，R8） */
export function createRoadmapNode(input: RoadmapNodeCreateInput): Promise<ApiResult<{ id: string }>> {
  return callAdmin<{ id: string }>('roadmap.create', input)
}

/** 更新路线图节点（内容字段变更会自动刷新 lastMaintainedAt） */
export function updateRoadmapNode(id: string, patch: RoadmapNodeUpdateInput): Promise<ApiResult<{ id: string }>> {
  return callAdmin<{ id: string }>('roadmap.update', { id, patch })
}

/** 数据看板 KPI 快照（M5；口径见 shared/domain/metrics） */
export function getMetrics(): Promise<ApiResult<MetricsSnapshot>> {
  return callAdmin<MetricsSnapshot>('metrics.dashboard', {})
}
