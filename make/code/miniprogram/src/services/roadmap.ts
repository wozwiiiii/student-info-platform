/** 路线图读取服务（A4，节点内嵌已发布的关联实时信息） */
import type { RoadmapNodeWithInfos } from '@shared/types'
import { callApi } from './cloud'

export interface RoadmapListResult {
  items: RoadmapNodeWithInfos[]
  total: number
}

export function listRoadmap(): Promise<RoadmapListResult> {
  return callApi<RoadmapListResult>('api-info', 'roadmap.list')
}
