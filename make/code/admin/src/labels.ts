/**
 * 枚举中文文案（唯一事实来源仍是 shared/types，此处仅做展示映射）
 */
import type { SourceType } from '@shared/types/common'
import type { InfoCategory, InfoSubType, ReviewStatus } from '@shared/types/information'

export interface Option<T extends string> {
  value: T
  label: string
}

export const CATEGORY_LABELS: Record<InfoCategory, string> = {
  opportunity: '机会成长',
  scholarship: '奖助评优',
  academic: '教务通知',
  lecture: '讲座活动'
}

export const SUB_TYPE_LABELS: Record<InfoSubType, string> = {
  competition: '竞赛',
  job_internship: '就业实习',
  postgrad: '保研',
  other: '其他'
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  wechat_mp: '公众号',
  official_site: '官网',
  user_submission: '投稿',
  manual: '人工'
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  collected: '已采集',
  ai_extracted: 'AI已提取',
  low_confidence: '低置信度待人工',
  pending_review: '待审核',
  published: '已发布',
  archived: '已归档',
  expired: '已过期',
  rejected: '已驳回',
  corrected: '已纠错'
}

function optionsOf<T extends string>(labels: Record<T, string>): Option<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }))
}

export const CATEGORY_OPTIONS: Option<InfoCategory>[] = optionsOf(CATEGORY_LABELS)
export const SUB_TYPE_OPTIONS: Option<InfoSubType>[] = optionsOf(SUB_TYPE_LABELS)
export const SOURCE_TYPE_OPTIONS: Option<SourceType>[] = optionsOf(SOURCE_TYPE_LABELS)
export const REVIEW_STATUS_OPTIONS: Option<ReviewStatus>[] = optionsOf(REVIEW_STATUS_LABELS)

/** 路线图学年/学期（A4；year=1~4，semester 1=秋 2=春） */
export const ROADMAP_YEAR_OPTIONS: Array<Option<string>> = [
  { value: '1', label: '大一' },
  { value: '2', label: '大二' },
  { value: '3', label: '大三' },
  { value: '4', label: '大四' }
]

export const ROADMAP_SEMESTER_OPTIONS: Array<Option<string>> = [
  { value: '1', label: '秋季学期' },
  { value: '2', label: '春季学期' }
]
