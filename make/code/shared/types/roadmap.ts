import type { InfoCategory, Information } from './information'
import type { IsoDate, IsoDateTime } from './common'

/** 简版成长路线图节点（spec v1.0 A4；R8：节点必须标注整理时间） */
export interface RoadmapNode {
  id: string
  /** 大一~大四 */
  year: 1 | 2 | 3 | 4
  /** 学期：1=秋 2=春 */
  semester: 1 | 2
  title: string
  description?: string
  /** 典型时间窗口（如「每年 3-4 月」），仅展示用 */
  typicalWindow?: string
  /** 关联信息类别（节点可挂实时信息流） */
  relatedCategory?: InfoCategory
  /** 关联的实时信息条目 id */
  relatedInfoIds: string[]
  /** 最后人工整理时间（必填，R8 防过期） */
  lastMaintainedAt: IsoDate
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** api-info roadmap.list 返回：节点内嵌已发布的关联实时信息（A4 节点关联实时信息） */
export interface RoadmapNodeWithInfos extends RoadmapNode {
  relatedInfos: Information[]
}
