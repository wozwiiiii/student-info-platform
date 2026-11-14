/**
 * 日期与东八区口径的唯一实现（AGENT.md §3.3 时间规则）
 *
 * 【整改记录】此前 deadline.ts / job-remind / api-admin / api-user 各写一遍时区换算，
 * 且都用 `new Date(x)` 判合法性，导致两类问题：
 *  1. 日域越界被 V8 顺延而非拒绝（2026-02-30 → 3/2），非法日期可入库（SN-08 / SN-39）；
 *  2. 无时区偏移的裸串按运行环境时区解析，跨时区算错（SN-05）；
 *  3. UTC 日期切片与 Asia/Shanghai 口径混用，边界漏统计（SN-42）。
 * 本模块统一收口，下游一律从这里取。
 */

/** Asia/Shanghai 相对 UTC 的固定偏移（中国无夏令时） */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * ISO 日期（YYYY-MM-DD）真实日历校验，含闰年 2/29。
 * 不能用 `new Date(s)` 判：V8 对日域越界会顺延（2026-02-30 → 2026-03-02）而非报错。
 */
export function isValidCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const year = Number(m[1] ?? 0)
  const month = Number(m[2] ?? 0)
  const day = Number(m[3] ?? 0)
  if (month < 1 || month > 12) return false
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0)
}

/**
 * ISO 日期时间必须带显式时区偏移（结尾为 Z 或 ±HH:MM），日期部分必须是真实日历日期。
 * 日期部分也校验：`2026-02-30T10:00:00+08:00` 这类不存在的日子同样拒绝
 * （V8 会把日域越界顺延而非报错，只靠 `new Date()` 判不出来）。
 */
export function isValidIsoDateTimeWithOffset(value: string): boolean {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  const datePart = value.slice(0, 10)
  if (!isValidCalendarDate(datePart)) return false
  return !Number.isNaN(new Date(value).getTime())
}

/** Asia/Shanghai 当天日期 YYYY-MM-DD（周活/投稿/lastMaintainedAt 统一口径） */
export function todayShanghaiDate(now: Date = new Date()): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

/** 任意时刻的 Asia/Shanghai 当天日期 YYYY-MM-DD（UTC 时刻 → 东八区日期） */
export function shanghaiDateOf(instant: Date | string): string {
  const t = typeof instant === 'string' ? new Date(instant).getTime() : instant.getTime()
  return new Date(t + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}
