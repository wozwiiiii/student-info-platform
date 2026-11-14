/**
 * job-remind：Deadline 临近提醒推送（A3 / R11，定时触发器每小时）
 * 流程：扫 published 且带 deadline 的信息 → dueReminderPoints 判定本次到期提醒点
 *       → 对持有授权余量（subscribe_record.quota > 0）的用户推送订阅消息
 *       → 成功消耗余量 1；失败写 push_fail 看板（R11：推送失败不静默）
 * 幂等：reminder_log 按 (infoId, remindAt, openId) 去重，重复执行不重发
 * 【客观事实】订阅消息为一次性授权；模板 ID 须在微信公众平台配置（环境变量 REMIND_TEMPLATE_ID
 *             或 shared/constants 默认值替换）；模板字段须与 buildData 的 thing1/time2 约定一致
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { nowIso, type InfoDoc } from '../../lib/doc'
import { dueReminderPoints, getDeadlineInstant } from '../../../shared/domain'
import { REMIND_TEMPLATE_ID, REMIND_WINDOW_MS } from '../../../shared/constants'
import type { Information, SubscribeRecord } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const INFORMATION = 'information'
const SUBSCRIBE_RECORD = 'subscribe_record'
const REMINDER_LOG = 'reminder_log'
const PUSH_FAIL = 'push_fail'

/** 单校试点规模假设：published 条目 ≤ 100/批，超出按 createdAt 老优先（如需扩展再分页） */
const BATCH_SIZE = 100
const RECIPIENT_LIMIT = 500
const PAGE_PATH = 'pages/calendar/index'

/** 订阅消息跳转页（M5：带 from=remind 供打开率埋点归因） */
function buildPage(infoId: string): string {
  return `${PAGE_PATH}?from=remind&infoId=${encodeURIComponent(infoId)}`
}

type SubscribeDoc = Omit<SubscribeRecord, 'id'> & { _id?: string }
type ReminderLogDoc = {
  infoId: string
  remindAt: string
  openId: string
  status: 'sent' | 'failed'
  at: string
  _id?: string
}

function templateId(): string {
  // 与 lib/llm.ts 同款取环境变量方式（无 @types/node，不用裸 process）
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  return env.REMIND_TEMPLATE_ID || REMIND_TEMPLATE_ID
}

/** 截止时间展示串（提醒内容用，Asia/Shanghai 固定偏移） */
function formatDeadline(deadline: Information['deadline']): string {
  if (!deadline) return ''
  if (deadline.precision === 'date') return deadline.date.slice(0, 10)
  const shifted = new Date(new Date(deadline.date).getTime() + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`
}

/** 订阅消息数据（【客观事实】字段 key 须与所选模板一致：thing1=标题，time2=截止时间） */
function buildData(info: InfoDoc): Record<string, { value: string }> {
  return {
    thing1: { value: (info.title ?? '').slice(0, 20) || '信息提醒' },
    time2: { value: formatDeadline(info.deadline) || '详见详情' }
  }
}

async function remindDue(): Promise<unknown> {
  const tpl = templateId()
  if (tpl.startsWith('REPLACE_')) {
    // 配置缺失不算推送失败，但必须显式报出，不允许静默跳过
    return fail(400, '未配置提醒订阅消息模板 ID（REMIND_TEMPLATE_ID），请先在微信公众平台订阅消息中配置模板')
  }

  const now = new Date()
  const nowStr = nowIso()
  const infoRes = await db.collection(INFORMATION)
    .where({ reviewStatus: 'published' })
    .orderBy('createdAt', 'desc')
    .limit(BATCH_SIZE)
    .get<InfoDoc>()

  // 提醒点必早于截止时刻 → 只需保留截止时刻晚于 (now - 窗口) 的条目
  const candidates = infoRes.data.filter(
    (d) => d.deadline && getDeadlineInstant(d.deadline).getTime() > now.getTime() - REMIND_WINDOW_MS
  )

  // 授权余量持有者（一次性授权，quota>0 才可推送；过期记录不计入）
  const subRes = await db.collection(SUBSCRIBE_RECORD)
    .where({ templateId: tpl })
    .limit(RECIPIENT_LIMIT)
    .get<SubscribeDoc>()
  // 整改 SN-22：必须在循环内维护剩余余量。原实现取查询快照后每次用 `rec.quota - 1` 写库，
  // 同一用户在一次运行命中多个提醒点时每次都按原值计算，quota=1 也会连发多条（实测 2 条），
  // 违反 R11「一次性授权 = 1 次可推送」。改为可变余量，用尽即停止。
  const recipients = subRes.data
    .filter((r) => (r.quota ?? 0) > 0 && (!r.expireAt || new Date(r.expireAt).getTime() > now.getTime()))
    .map((r) => ({ ...r, remaining: r.quota ?? 0 }))

  // 整改 SN-23：原实现在三重循环内逐条查 reminder_log，规模上界
  // BATCH_SIZE(100) × 提醒点(2) × RECIPIENT_LIMIT(500) = 10 万次读/小时。
  // 改为每个 infoId 预取一次，循环内查内存集合。
  const loggedByInfo = new Map<string, Set<string>>()
  for (const info of candidates) {
    if (!info._id) continue
    const logged = await db.collection(REMINDER_LOG).where({ infoId: info._id }).limit(5000).get<ReminderLogDoc>()
    loggedByInfo.set(info._id, new Set(logged.data.map((l) => `${l.remindAt}|${l.openId}`)))
  }

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const info of candidates) {
    if (!info._id || !info.deadline) continue
    for (const remindAt of dueReminderPoints(info.deadline, now, REMIND_WINDOW_MS)) {
      for (const rec of recipients) {
        if (rec.remaining <= 0) continue // 授权余量已用尽
        const logKey = `${remindAt}|${rec.openId}`
        if (loggedByInfo.get(info._id)?.has(logKey)) {
          skipped++
          continue
        }
        try {
          const res = await cloud.openapi.subscribeMessage.send({
            touser: rec.openId,
            template_id: tpl,
            page: buildPage(info._id),
            data: buildData(info)
          })
          if (res && typeof res.errCode === 'number' && res.errCode !== 0) {
            throw new Error(`errCode=${res.errCode} ${res.errMsg ?? ''}`)
          }
          // 成功才消耗授权余量（R11）；余量在循环内递减，避免同一次运行超发（SN-22）
          rec.remaining -= 1
          await db.collection(SUBSCRIBE_RECORD).doc(rec._id as string).update({
            quota: rec.remaining,
            usedAt: nowStr
          })
          if (rec.remaining <= 0) {
            await db.collection('user').where({ openId: rec.openId }).update({ subscribeState: 'none', updatedAt: nowStr })
          }
          await db.collection(REMINDER_LOG).add({
            infoId: info._id, remindAt, openId: rec.openId, status: 'sent', at: nowStr
          } as unknown as Record<string, unknown>)
          sent++
        } catch (error) {
          // R11：推送失败进看板，不静默；记 reminder_log 不再重试，避免每小时重复失败刷屏
          const reason = error instanceof Error ? error.message : String(error)
          logError(`job-remind:${info._id}:${rec.openId}`, error)
          await db.collection(PUSH_FAIL).add({
            openId: rec.openId,
            infoId: info._id,
            templateId: tpl,
            reason,
            at: nowStr
          } as unknown as Record<string, unknown>)
          await db.collection(REMINDER_LOG).add({
            infoId: info._id, remindAt, openId: rec.openId, status: 'failed', at: nowStr
          } as unknown as Record<string, unknown>)
          failed++
        }
      }
    }
  }
  return ok({ scanned: infoRes.data.length, candidates: candidates.length, recipients: recipients.length, sent, failed, skipped })
}

export async function main(event: { action?: string }): Promise<unknown> {
  try {
    switch (event?.action) {
      case 'remind.due':
      case undefined:
        return await remindDue()
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('job-remind', error)
    return fail(500, '服务内部错误')
  }
}
