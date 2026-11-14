/**
 * api-user：微信授权登录、订阅授权记录与埋点（M3：C1/D0 + A3/R11；M5：指标埋点）
 * 契约：event = { action, payload }，返回 { code, message, data }
 *  - user.login        无需 payload：OPENID 幂等 upsert 落 user 集合，返回用户资料
 *  - user.profile      payload: UserProfileInput（学院/年级选填，为 V1 的 A7 过滤积累）
 *  - subscribe.record  payload: SubscribeRecordInput（requestSubscribeMessage 成功后上报，记授权余量）
 *  - subscribe.status  无需 payload：返回当前用户授权余量
 *  - track.activity    无需 payload：每日活跃埋点（openId + 当天幂等，支撑周活）
 *  - track.event       payload: TrackEventInput（当前仅订阅消息回流打开，支撑打开率）
 * 【客观事实】OPENID 只在微信小程序调用上下文存在，其他环境返回 401
 */
import cloud from 'wx-server-sdk'
import { fail, logError, ok } from '../../lib/result'
import { nowIso } from '../../lib/doc'
import { subscribeRecordSchema, trackEventSchema, userProfileSchema } from '../../../shared/schemas'
import type { SubscribeRecord, User, UserSubscribeState } from '../../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const USER = 'user'
const SUBSCRIBE_RECORD = 'subscribe_record'
const ACTIVITY_LOG = 'activity_log'
const EVENT_LOG = 'event_log'

/** 订阅授权上报去重窗口（毫秒）：窗口内同 (openId, templateId) 视为同一次授权的重试（SN-25） */
const SUBSCRIBE_DEDUP_WINDOW_MS = 60 * 1000

type UserDoc = User & { _id?: string }
type SubscribeDoc = Omit<SubscribeRecord, 'id'> & { _id?: string }

function currentOpenId(): string {
  return cloud.getWXContext().OPENID ?? ''
}

async function findUser(openId: string): Promise<UserDoc | null> {
  const res = await db.collection(USER).where({ openId }).limit(1).get<UserDoc>()
  return res.data[0] ?? null
}

/** 幂等 upsert：登录/上报授权时确保 user 文档存在（AGENT.md §4.5） */
async function ensureUser(openId: string): Promise<UserDoc> {
  const existing = await findUser(openId)
  if (existing) return existing
  const at = nowIso()
  const doc: UserDoc = { openId, subscribeState: 'none', createdAt: at, updatedAt: at }
  const added = await db.collection(USER).add(doc as unknown as Record<string, unknown>)
  return { ...doc, _id: added._id }
}

function toPublicUser(doc: UserDoc): User & { id: string } {
  const { _id, ...rest } = doc
  return { id: _id ?? '', ...rest }
}

/** Asia/Shanghai 当天日期（周活按天去重） */
function todayIsoDate(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function login(): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const created = !(await findUser(openId))
  const user = await ensureUser(openId)
  return ok({ user: toPublicUser(user), created })
}

async function updateProfile(raw: Record<string, unknown>): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const parsed = userProfileSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  await ensureUser(openId)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: nowIso() }
  await db.collection(USER).where({ openId }).update(patch)
  return ok({ openId })
}

async function recordSubscribe(raw: Record<string, unknown>): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const parsed = subscribeRecordSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const input = parsed.data
  await ensureUser(openId)

  // 整改 SN-25：原实现每次调用都 add 一条，客户端网络重试/重复点击会为同一次「一次性授权」
  // 记多条 quota，直接虚增可推送次数（违反 R11）。改为同 (openId, templateId) 在去重窗口内幂等。
  const recent = await db.collection(SUBSCRIBE_RECORD).where({ openId, templateId: input.templateId }).limit(50).get<SubscribeDoc>()
  const at = nowIso()
  const dup = recent.data.find((r) => {
    const t = new Date(r.subscribedAt ?? 0).getTime()
    return Number.isFinite(t) && Date.now() - t < SUBSCRIBE_DEDUP_WINDOW_MS
  })
  if (dup) {
    await db.collection(USER).where({ openId }).update({ subscribeState: 'active', updatedAt: at })
    return ok({ id: dup._id ?? '', quota: dup.quota ?? 0, duplicate: true })
  }

  // 客观事实：一次性授权 = quota 1，每次成功推送消耗 1（R11）
  const doc: SubscribeDoc = {
    openId,
    templateId: input.templateId,
    quota: input.quota,
    subscribedAt: at,
    ...(input.expireAt ? { expireAt: input.expireAt } : {})
  }
  const added = await db.collection(SUBSCRIBE_RECORD).add(doc as unknown as Record<string, unknown>)

  const state: UserSubscribeState = 'active'
  await db.collection(USER).where({ openId }).update({ subscribeState: state, updatedAt: at })
  return ok({ id: added._id, quota: input.quota })
}

async function subscribeStatus(): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const user = await findUser(openId)
  const res = await db.collection(SUBSCRIBE_RECORD).where({ openId }).limit(100).get<SubscribeDoc>()
  const now = Date.now()
  const valid = res.data.filter((r) => !r.expireAt || new Date(r.expireAt).getTime() > now)
  const totalQuota = valid.reduce((sum, r) => sum + (r.quota ?? 0), 0)
  return ok({
    subscribeState: user?.subscribeState ?? 'none',
    totalQuota,
    records: valid.map(({ _id, ...rest }) => ({ id: _id, ...rest }))
  })
}

/** 埋点：每日活跃（openId + 当天幂等去重，支撑周活 M5） */
async function trackActivity(): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const date = todayIsoDate()
  const existing = await db.collection(ACTIVITY_LOG).where({ openId, date }).limit(1).get()
  if (existing.data.length > 0) {
    return ok({ recorded: false })
  }
  await db.collection(ACTIVITY_LOG).add({ openId, date, at: nowIso() })
  return ok({ recorded: true })
}

/**
 * 埋点：事件上报（当前仅订阅消息回流打开，支撑打开率 M5）
 *
 * 整改 SN-47：原实现直接 add，无去重无频控。metrics.dashboard 的 reminderOpens 是
 * `count(event_log.type='open_remind')`，同一用户反复上报即可无限抬高「打开率」，
 * 看板数据不可信（对照 track.activity 已按 (openId, date) 幂等）。
 * 现按 (openId, type, infoId) 幂等：同一用户对同一信息的重复打开只记一次。
 */
async function trackEvent(raw: Record<string, unknown>): Promise<unknown> {
  const openId = currentOpenId()
  if (!openId) return fail(401, '缺少 OPENID：请从微信小程序调用')
  const parsed = trackEventSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(400, `校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`)
  }
  const infoId = parsed.data.infoId
  const query: Record<string, unknown> = { openId, type: parsed.data.type }
  if (infoId) query.infoId = infoId
  const existing = await db.collection(EVENT_LOG).where(query).limit(1).get()
  if (existing.data.length > 0) {
    return ok({ openId, recorded: false })
  }

  await db.collection(EVENT_LOG).add({
    openId,
    type: parsed.data.type,
    ...(infoId ? { infoId } : {}),
    at: nowIso()
  })
  return ok({ openId, recorded: true })
}

export async function main(event: {
  action?: string
  payload?: Record<string, unknown>
}): Promise<unknown> {
  try {
    const raw = event?.payload ?? {}
    switch (event?.action) {
      case 'user.login':
        return await login()
      case 'user.profile':
        return await updateProfile(raw)
      case 'subscribe.record':
        return await recordSubscribe(raw)
      case 'subscribe.status':
        return await subscribeStatus()
      case 'track.activity':
        return await trackActivity()
      case 'track.event':
        return await trackEvent(raw)
      default:
        return fail(400, `未知 action: ${String(event?.action)}`)
    }
  } catch (error) {
    logError('api-user', error)
    return fail(500, '服务内部错误')
  }
}
