import type { DeadlineInfo, IsoDateTime, SourceType } from './common'

/** 信息类别（spec v1.0 §2：机会成长 > 奖助评优 > 教务通知，讲座活动可选） */
export type InfoCategory = 'opportunity' | 'scholarship' | 'academic' | 'lecture'

/** 机会成长子类（MVP P0 聚焦竞赛 + 就业实习，保研走公开政策兜底） */
export type InfoSubType = 'competition' | 'job_internship' | 'postgrad' | 'other'

/**
 * 审核状态机（AGENT.md §3.3）：
 * collected → ai_extracted → pending_review → published → archived/expired
 * low_confidence 强制转人工；任意态可 → rejected / corrected
 */
export type ReviewStatus =
  | 'collected'
  | 'ai_extracted'
  | 'low_confidence'
  | 'pending_review'
  | 'published'
  | 'archived'
  | 'expired'
  | 'rejected'
  | 'corrected'

/** AI 结构化预审结果（AGENT.md §4.3：AI 输出永不直接发布） */
export interface AiExtraction {
  fields: {
    title?: string
    deadline?: DeadlineInfo
    eventTime?: DeadlineInfo
    location?: string
    targetAudience?: string
    category?: InfoCategory
    subType?: InfoSubType
  }
  /** 0~1，低于阈值强制转人工 */
  confidence: number
  model?: string
  extractedAt?: IsoDateTime
}

/** 信息条目（核心实体，对应云数据库 information 集合） */
export interface Information {
  id: string
  title: string
  category: InfoCategory
  subType?: InfoSubType
  summary?: string
  content?: string
  deadline?: DeadlineInfo
  /** 发布硬校验：deadline 类信息必须人工复核后才可 published（R12） */
  deadlineVerifiedByHuman: boolean
  eventTime?: DeadlineInfo
  location?: string
  targetAudience?: string
  /** 来源链接（sourceUrl 与 sourceChannel 至少一个，AGENT.md §4.4） */
  sourceUrl: string
  sourceChannel: string
  sourceType: SourceType
  /** 去重哈希：hash(normalized(title) + sourceChannel) */
  contentHash: string
  aiExtract?: AiExtraction
  reviewStatus: ReviewStatus
  publishedAt?: IsoDateTime
  expiredAt?: IsoDateTime
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
