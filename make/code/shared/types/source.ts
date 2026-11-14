import type { IsoDateTime, SourceType } from './common'

/** 信息来源渠道（R10：爬取失败率与可靠性留痕） */
export interface Source {
  id: string
  name: string
  type: SourceType
  /** 监控方式：scheduled_crawl=定时爬取 / manual_monitor=本机半自动 / none=纯人工 */
  monitorMethod: 'scheduled_crawl' | 'manual_monitor' | 'none'
  homepageUrl?: string
  lastFetchedAt?: IsoDateTime
  /** 0~1，解析失败率高的来源降低优先级并告警 */
  reliability: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
