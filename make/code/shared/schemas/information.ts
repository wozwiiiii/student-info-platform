/**
 * 信息条目写操作校验（AGENT.md §4.2：所有对外写操作必须过 zod 校验）
 */
import { z } from 'zod'
import { isValidDeadline } from '../domain/deadline'

export const infoCategorySchema = z.enum(['opportunity', 'scholarship', 'academic', 'lecture'])
export const infoSubTypeSchema = z.enum(['competition', 'job_internship', 'postgrad', 'other'])
export const sourceTypeSchema = z.enum(['wechat_mp', 'official_site', 'user_submission', 'manual'])

export const deadlineSchema = z
  .object({
    date: z.string().min(1),
    precision: z.enum(['date', 'datetime']),
    // SN-04：本系统固定 Asia/Shanghai（deadline.ts 按 +08:00 计算），拒绝其他时区以免「声明与计算不一致」
    tz: z.literal('Asia/Shanghai').default('Asia/Shanghai')
  })
  // SN-05/SN-08：真实日历校验 + datetime 必须带显式时区偏移（见 domain/deadline.isValidDeadline）
  .refine((d) => isValidDeadline(d), { message: 'deadline.date 不是合法 ISO 时间（日期须真实存在、datetime 须带时区偏移）' })

/**
 * 信息创建输入。
 *
 * 【整改记录 SN-01】**不含** `deadlineVerifiedByHuman`：该字段语义是「审核员已人工复核
 * 截止日期」（AGENT.md §4.3 / R12），不能由写入方自报。此前 schema 接受客户端提交 true 并
 * 原样落库，导致「创建时自报 true → 后续发布」可绕过独立的人工复核动作。
 * 现在写入侧一律由服务端置 false，只有 `info.review` 审核动作可置 true。
 */
export const informationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: infoCategorySchema,
    subType: infoSubTypeSchema.optional(),
    summary: z.string().max(500).optional(),
    content: z.string().max(20000).optional(),
    deadline: deadlineSchema.optional(),
    eventTime: deadlineSchema.optional(),
    location: z.string().max(200).optional(),
    targetAudience: z.string().max(200).optional(),
    sourceUrl: z.string().trim().max(1000).default(''),
    sourceChannel: z.string().trim().max(200).default(''),
    sourceType: sourceTypeSchema
  })
  .refine((v) => v.sourceUrl !== '' || v.sourceChannel !== '', {
    message: 'sourceUrl 与 sourceChannel 至少填一个（不做无来源信息）',
    path: ['sourceChannel']
  })

export type InformationCreateInput = z.infer<typeof informationCreateSchema>

/**
 * 信息更新补丁校验（整改记录 SN-17）。
 *
 * 依据：AGENT.md §4.2「所有对外写操作必须过 zod 校验」，而 api-admin 的 info.update 此前
 * 只做字段白名单复制、对值不作任何校验，非法 deadline / 空标题 / 超长字段可直接落库。
 * 本 schema 只校验「字段值合法」，来源与复核标记的门禁由调用方按 §4.3/§4.4 另行强制。
 */
export const informationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: infoCategorySchema,
    subType: infoSubTypeSchema,
    summary: z.string().max(500),
    content: z.string().max(20000),
    deadline: deadlineSchema,
    eventTime: deadlineSchema,
    location: z.string().max(200),
    targetAudience: z.string().max(200),
    sourceUrl: z.string().trim().max(1000),
    sourceChannel: z.string().trim().max(200),
    sourceType: sourceTypeSchema
  })
  .partial()

export type InformationPatchInput = z.infer<typeof informationPatchSchema>
