/**
 * 路线图节点领域纯函数（spec A4；R8：节点过期风险 → 待维护视图）
 * 时间规则与 deadline.ts 一致：ISO 日期按 Asia/Shanghai（UTC+8 固定偏移）解释
 */
import type { RoadmapNode } from '../types'

const TZ_OFFSET = '+08:00'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 「待维护」阈值：距最后整理日结束时刻满 180 天即待维护。
 * 【假设】180 天为运营预设值，需按实际整理节奏校准（spec R8 未给出具体天数）。
 */
export const ROADMAP_STALE_DAYS = 180

/** 仅日期 → 当天 23:59:59+08:00（整理日当天视为有效） */
function dayEnd(dateOnly: string): Date {
  return new Date(`${dateOnly.slice(0, 10)}T23:59:59${TZ_OFFSET}`)
}

/**
 * 节点是否「待维护」（R8）：now 距 lastMaintainedAt 当天结束已满 staleDays 整天。
 * 边界语义：恰好 staleDays 天即算待维护（>=）。
 */
export function isNodeStale(
  node: Pick<RoadmapNode, 'lastMaintainedAt'>,
  now: Date,
  staleDays: number = ROADMAP_STALE_DAYS
): boolean {
  return now.getTime() - dayEnd(node.lastMaintainedAt).getTime() >= staleDays * DAY_MS
}

/** 过滤出待维护节点（后台「待维护节点」视图，R8） */
export function filterStaleNodes<T extends Pick<RoadmapNode, 'lastMaintainedAt'>>(
  nodes: readonly T[],
  now: Date,
  staleDays: number = ROADMAP_STALE_DAYS
): T[] {
  return nodes.filter((n) => isNodeStale(n, now, staleDays))
}

export interface RoadmapGroup<R extends Pick<RoadmapNode, 'year' | 'semester'> = RoadmapNode> {
  year: 1 | 2 | 3 | 4
  semester: 1 | 2
  nodes: R[]
}

/**
 * 按「学年 + 学期」分组并排序（大一上 → 大四下；小程序路线图页 A4 展示顺序）。
 * 组内节点保持传入顺序。
 */
export function groupNodesByYearSemester<R extends Pick<RoadmapNode, 'year' | 'semester'>>(
  nodes: readonly R[]
): RoadmapGroup<R>[] {
  const buckets = new Map<string, RoadmapGroup<R>>()
  for (const node of nodes) {
    const key = `${node.year}-${node.semester}`
    const group = buckets.get(key)
    if (group) {
      group.nodes.push(node)
    } else {
      buckets.set(key, { year: node.year, semester: node.semester, nodes: [node] })
    }
  }
  return [...buckets.values()].sort((a, b) => a.year - b.year || a.semester - b.semester)
}
