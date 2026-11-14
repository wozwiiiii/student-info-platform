/** 标题关键词粗分类（采集/投稿初判；AI 提取可修正，人工复核兜底） */
import type { InfoCategory, InfoSubType } from '../../shared/types'

export function classifyByTitle(title: string): { category: InfoCategory; subType?: InfoSubType } {
  if (/保研|推免/.test(title)) return { category: 'opportunity', subType: 'postgrad' }
  if (/竞赛|大赛|比赛/.test(title)) return { category: 'opportunity', subType: 'competition' }
  if (/招聘|实习|就业|校招|宣讲/.test(title)) return { category: 'opportunity', subType: 'job_internship' }
  if (/奖学金|助学|评优|表彰/.test(title)) return { category: 'scholarship' }
  if (/讲座|活动|论坛/.test(title)) return { category: 'lecture' }
  return { category: 'academic' }
}

/** 采集候选链接的关键词过滤（官方列表页噪音多，只留成长相关条目） */
export const CRAWL_KEYWORDS = /通知|公告|报名|竞赛|大赛|比赛|招聘|实习|就业|校招|宣讲|保研|推免|奖学金|助学|评优|讲座|活动|选拔/
