/**
 * 路线图节点写操作校验（AGENT.md §4.2：所有对外写操作必须过 zod 校验；R8：lastMaintainedAt 必填）
 */
import { z } from 'zod'
import { infoCategorySchema } from './information'
import { isValidCalendarDate } from '../domain/date'

export const roadmapYearSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export const roadmapSemesterSchema = z.union([z.literal(1), z.literal(2)])

/** 无默认值的基础形状（update 直接 partial，防止 patch 缺字段时被默认值覆盖） */
const roadmapNodeBaseShape = {
  /** 大一~大四 */
  year: roadmapYearSchema,
  /** 学期：1=秋 2=春 */
  semester: roadmapSemesterSchema,
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  /** 典型时间窗口（如「每年 3-4 月」），仅展示用 */
  typicalWindow: z.string().trim().max(100).optional(),
  /** 关联信息类别（节点可挂实时信息流） */
  relatedCategory: infoCategorySchema.optional(),
  /** 关联的实时信息条目 id */
  relatedInfoIds: z.array(z.string().trim().min(1)).max(50),
  /** 最后人工整理时间（必填，R8 防过期）：ISO 日期 YYYY-MM-DD */
  lastMaintainedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'lastMaintainedAt 须为 ISO 日期 YYYY-MM-DD')
    // 整改 SN-39：改用真实日历校验，2026-02-30 / 2026-04-31 / 平年 2-29 一律拒绝
    // （原用 new Date() 判，V8 对日域越界会顺延而非报错）
    .refine(isValidCalendarDate, 'lastMaintainedAt 不是真实存在的日历日期')
}

export const roadmapNodeCreateSchema = z
  .object(roadmapNodeBaseShape)
  .extend({ relatedInfoIds: roadmapNodeBaseShape.relatedInfoIds.default([]) })

export const roadmapNodeUpdateSchema = z.object(roadmapNodeBaseShape).partial()

export type RoadmapNodeCreateInput = z.infer<typeof roadmapNodeCreateSchema>
export type RoadmapNodeUpdateInput = z.infer<typeof roadmapNodeUpdateSchema>
