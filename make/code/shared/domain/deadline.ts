/**
 * 截止时间与提醒排程（产品原则：截止时间是第一公民）
 * 时间规则：存储 ISO 8601 + 显式时区偏移（AGENT.md §3.3）；本模块统一按 Asia/Shanghai
 * （UTC+8 固定偏移，中国无夏令时）解释。日历与偏移校验收口在 ./date。
 */
import type { DeadlineInfo } from '../types'
import { isValidCalendarDate, isValidIsoDateTimeWithOffset, SHANGHAI_OFFSET_MS } from './date'

export const DISPLAY_TZ = 'Asia/Shanghai'
const TZ_OFFSET = '+08:00'

/** 提醒提前量（天），MVP 排程：截止前 3 天、1 天 */
export const REMINDER_OFFSETS_DAYS = [3, 1] as const

/** 仅日期 → 当天 23:59:59+08:00（date 精度的截止时刻为当天结束） */
export function getDeadlineInstant(deadline: DeadlineInfo): Date {
  if (deadline.precision === 'date') {
    return new Date(`${deadline.date.slice(0, 10)}T23:59:59${TZ_OFFSET}`)
  }
  return new Date(deadline.date)
}

/** 仅日期 → 当天 hh:00:00+08:00 */
function morningOf(dateOnly: string, hourOfDay: number): Date {
  const hh = String(hourOfDay).padStart(2, '0')
  return new Date(`${dateOnly.slice(0, 10)}T${hh}:00:00${TZ_OFFSET}`)
}

/**
 * 校验 DeadlineInfo 自洽性（写入侧唯一门禁）。
 *
 * 【整改记录】
 *  - SN-08/SN-39：改用真实日历校验，2026-02-30、2026-04-31、平年 2/29 一律拒绝
 *    （此前用 `new Date(x)` 判，V8 对日域越界会顺延而非报错）。
 *  - SN-05：datetime 精度必须带显式时区偏移（Z 或 ±HH:MM），
 *    否则解析结果随运行环境时区漂移。
 *  - SN-04：tz 必须是 Asia/Shanghai。本模块固定按 +08:00 计算，
 *    若允许其他 tz 会导致「声明与计算不一致」，因此在入口就拒绝。
 */
export function isValidDeadline(deadline: DeadlineInfo): boolean {
  if (deadline.tz !== DISPLAY_TZ) return false
  if (deadline.precision === 'date') {
    return isValidCalendarDate(deadline.date)
  }
  return isValidIsoDateTimeWithOffset(deadline.date)
}

/** 排程入参校验（SN-06：非法值此前会被静默丢弃，不报错不告警） */
function assertScheduleOptions(hourOfDay: number, offsets: readonly number[]): void {
  if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
    throw new RangeError(`hourOfDay 须为 0~23 的整数，收到 ${String(hourOfDay)}`)
  }
  for (const d of offsets) {
    if (!Number.isInteger(d) || d < 0) {
      throw new RangeError(`offsetsDays 须为非负整数数组，收到 ${String(d)}`)
    }
  }
}

/**
 * 计算提醒排程（A3 / R11）：
 * - precision=date：截止日前 N 天的 09:00（可配 hourOfDay）
 * - precision=datetime：截止时刻前 N×24 小时
 * 只返回严格晚于 now 的提醒点（已过去的不排）；结果按时间升序
 */
export function computeReminderSchedule(
  deadline: DeadlineInfo,
  now: Date,
  opts?: { hourOfDay?: number; offsetsDays?: readonly number[] }
): string[] {
  const hourOfDay = opts?.hourOfDay ?? 9
  const offsets = opts?.offsetsDays ?? REMINDER_OFFSETS_DAYS
  assertScheduleOptions(hourOfDay, offsets)

  const base = deadline.precision === 'date' ? deadline.date.slice(0, 10) : null

  const points: Date[] = []
  for (const days of offsets) {
    if (base) {
      const d = new Date(morningOf(base, hourOfDay).getTime() - days * 24 * 60 * 60 * 1000)
      points.push(d)
    } else {
      points.push(new Date(getDeadlineInstant(deadline).getTime() - days * 24 * 60 * 60 * 1000))
    }
  }
  return points
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => d.toISOString())
}

/**
 * 本次定时任务应推送的提醒点（A3）：落在 (now - windowMs, now] 区间的排程点。
 * 配合 reminder_log 幂等去重，窗口重叠不会导致重发。
 */
export function dueReminderPoints(
  deadline: DeadlineInfo,
  now: Date,
  windowMs: number,
  opts?: { hourOfDay?: number; offsetsDays?: readonly number[] }
): string[] {
  return computeReminderSchedule(deadline, new Date(now.getTime() - windowMs), opts).filter(
    (iso) => new Date(iso).getTime() <= now.getTime()
  )
}

/** 东八区偏移量（供展示层/换算复用，避免各处硬编码 8*60*60*1000） */
export const SHANGHAI_OFFSET = SHANGHAI_OFFSET_MS
