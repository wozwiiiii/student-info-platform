import type { IsoDateTime } from './common'

/** 众包投稿（spec v1.0 B5：提交链接 + 来源，AI 预审 + 人工确认） */
export interface Submission {
  id: string
  submitterOpenId: string
  /** 投稿指向的原文链接 */
  url: string
  /** 来源渠道描述（公众号名/网站名等），可空但建议填 */
  sourceChannel?: string
  note?: string
  /** AI 预审结论（仅建议，不直接入库） */
  aiPreReview?: {
    legalSource: boolean
    duplicateInfoId?: string
    confidence: number
  }
  status: 'pending' | 'accepted' | 'rejected' | 'duplicate'
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
