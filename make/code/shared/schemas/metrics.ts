/**
 * 埋点写操作校验（AGENT.md §4.2：所有对外写操作必须过 zod 校验）
 */
import { z } from 'zod'

/** 埋点事件上报（当前仅订阅消息回流打开） */
export const trackEventSchema = z.object({
  type: z.literal('open_remind'),
  infoId: z.string().trim().min(1).max(100).optional()
})

export type TrackEventInput = z.infer<typeof trackEventSchema>
