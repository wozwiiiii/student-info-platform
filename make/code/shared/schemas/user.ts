/**
 * 用户/订阅写操作校验（AGENT.md §4.2：所有对外写操作必须过 zod 校验）
 */
import { z } from 'zod'

/** 个人资料（学院/年级选填，为 V1 的 A7 过滤积累） */
export const userProfileSchema = z.object({
  college: z.string().trim().max(50).optional(),
  grade: z.string().trim().max(20).optional()
})

/** 订阅授权记录（requestSubscribeMessage 成功后由客户端上报） */
export const subscribeRecordSchema = z.object({
  templateId: z.string().trim().min(1).max(100),
  /** 单次授权 = 1 次可推送；上限 100 防误传 */
  quota: z.number().int().min(1).max(100).default(1),
  expireAt: z.string().min(1).optional()
})

export type UserProfileInput = z.infer<typeof userProfileSchema>
export type SubscribeRecordInput = z.infer<typeof subscribeRecordSchema>
