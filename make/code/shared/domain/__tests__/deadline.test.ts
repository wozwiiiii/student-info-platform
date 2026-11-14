import { describe, expect, it } from 'vitest'
import { computeReminderSchedule, dueReminderPoints, getDeadlineInstant, isValidDeadline } from '../deadline'

const iso = (s: string) => new Date(s).toISOString()

describe('getDeadlineInstant', () => {
  it('date 精度取当天 23:59:59(+08:00)', () => {
    expect(getDeadlineInstant({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }).toISOString())
      .toBe(iso('2026-11-04T23:59:59+08:00'))
  })

  it('datetime 精度取原时刻', () => {
    expect(getDeadlineInstant({ date: '2026-11-04T18:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' }).toISOString())
      .toBe(iso('2026-11-04T18:00:00+08:00'))
  })
})

describe('isValidDeadline', () => {
  it('date 精度只接受 YYYY-MM-DD', () => {
    expect(isValidDeadline({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' })).toBe(true)
    expect(isValidDeadline({ date: '2026-11-04T00:00:00+08:00', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: 'not-a-date', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(false)
  })

  it('date 精度做真实日历校验（SN-08/SN-39 整改：日域越界不再被 V8 顺延放行）', () => {
    expect(isValidDeadline({ date: '2026-02-30', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: '2026-04-31', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: '2026-02-29', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: '2028-02-29', precision: 'date', tz: 'Asia/Shanghai' })).toBe(true)
    expect(isValidDeadline({ date: '2026-13-01', precision: 'date', tz: 'Asia/Shanghai' })).toBe(false)
  })
})

describe('computeReminderSchedule', () => {
  const now = new Date('2026-10-28T00:00:00+08:00')

  it('date 精度：截止前 3 天、1 天的 09:00(+08:00)', () => {
    const result = computeReminderSchedule(
      { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' },
      now
    )
    expect(result).toEqual([
      iso('2026-11-01T09:00:00+08:00'),
      iso('2026-11-03T09:00:00+08:00')
    ])
  })

  it('已过去的提醒点不排', () => {
    const lateNow = new Date('2026-11-02T00:00:00+08:00')
    const result = computeReminderSchedule(
      { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' },
      lateNow
    )
    expect(result).toEqual([iso('2026-11-03T09:00:00+08:00')])
  })

  it('datetime 精度：按截止时刻前推 N×24 小时', () => {
    const result = computeReminderSchedule(
      { date: '2026-11-04T18:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' },
      now
    )
    expect(result).toEqual([
      iso('2026-11-01T18:00:00+08:00'),
      iso('2026-11-03T18:00:00+08:00')
    ])
  })
})

describe('dueReminderPoints', () => {
  const deadline = { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' } as const
  const windowMs = 2 * 60 * 60 * 1000

  it('只返回落在 (now-window, now] 的提醒点', () => {
    const now = new Date('2026-11-01T10:00:00+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([iso('2026-11-01T09:00:00+08:00')])
  })

  it('窗口内无提醒点时返回空', () => {
    const now = new Date('2026-11-02T10:00:00+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([])
  })

  it('未来提醒点不提前返回', () => {
    const now = new Date('2026-10-31T10:00:00+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([])
  })
})

describe('【已整改 SN-04】tz 不再被忽略：非 Asia/Shanghai 一律拒绝', () => {
  /**
   * 【整改记录 SN-04】
   * 原缺陷：deadline.ts 硬编码 TZ_OFFSET='+08:00'，从不读取 deadline.tz，
   * tz='UTC' 的记录仍按 +08:00 解释，tz 形同虚设（声明与计算不一致）。
   * 现整改：isValidDeadline 在入口强制 tz === 'Asia/Shanghai'，其他时区一律判非法；
   * getDeadlineInstant 保持固定按 +08:00 计算（tz 恒为 Asia/Shanghai 的契约下行为不变）。
   */
  it('已整改：tz=UTC / 任意串被判非法，Asia/Shanghai 通过', () => {
    expect(isValidDeadline({ date: '2026-11-04', precision: 'date', tz: 'UTC' })).toBe(false)
    expect(isValidDeadline({ date: '2026-11-04', precision: 'date', tz: 'Mars/Olympus' })).toBe(false)
    expect(isValidDeadline({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' })).toBe(true)
  })

  it('已整改：getDeadlineInstant 在 tz 恒为 Asia/Shanghai 的契约下固定按 +08:00 计算', () => {
    const d = getDeadlineInstant({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' })
    expect(d.toISOString()).toBe(iso('2026-11-04T23:59:59+08:00'))
  })
})

describe('【已整改 SN-05】datetime 精度必须带显式时区偏移', () => {
  /**
   * 【整改记录 SN-05】
   * 原缺陷：isValidDeadline 对 precision=datetime 只判 `new Date(x)` 非 NaN，
   * 接受 '2026-11-04T18:00:00' 与 '2026-11-04' 这类无偏移裸串，解析结果随运行环境时区漂移。
   * 现整改：datetime 精度必须以 Z 或 ±HH:MM 结尾，否则一律判非法。
   */
  it('已整改：无偏移裸串被判非法，带偏移串合法', () => {
    expect(isValidDeadline({ date: '2026-11-04T18:00:00', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: '2026-11-04', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(false)
    expect(isValidDeadline({ date: '2026-11-04T18:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(true)
    expect(isValidDeadline({ date: '2026-11-04T18:00:00Z', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(true)
  })

  it('已整改：datetime 精度的 date-only 串在门禁被拒（getDeadlineInstant 仅做纯转换）', () => {
    // 校验收口在 isValidDeadline（写入侧唯一门禁），转换器不做二次校验
    expect(isValidDeadline({ date: '2026-11-04', precision: 'datetime', tz: 'Asia/Shanghai' })).toBe(false)
    const d = getDeadlineInstant({ date: '2026-11-04', precision: 'datetime', tz: 'Asia/Shanghai' })
    expect(d.toISOString()).toBe(iso('2026-11-04T00:00:00Z'))
  })
})

describe('【已整改 SN-06】computeReminderSchedule 对 hourOfDay / offsetsDays 做范围校验', () => {
  /**
   * 【整改记录 SN-06】
   * 原缺陷：hourOfDay 越界（25、-1、24）生成非法时间串 → Date 为 Invalid →
   * 被 `d.getTime() > now.getTime()` 静默过滤，提醒点无声丢失，不报错也不告警；
   * 负 offsetsDays 会排出「截止之后」的提醒点。
   * 现整改：入参非法一律抛 RangeError，不再静默丢弃。
   */
  const deadline = { date: '2026-11-04', precision: 'date' as const, tz: 'Asia/Shanghai' }
  const now = new Date('2026-10-28T00:00:00+08:00')

  it('已整改：hourOfDay=25 / -1 / 24 抛 RangeError', () => {
    expect(() => computeReminderSchedule(deadline, now, { hourOfDay: 25 })).toThrow(RangeError)
    expect(() => computeReminderSchedule(deadline, now, { hourOfDay: -1 })).toThrow(RangeError)
    expect(() => computeReminderSchedule(deadline, now, { hourOfDay: 24 })).toThrow(RangeError)
  })

  it('已整改：负 offsetsDays 抛 RangeError（不再排出「截止之后」的提醒点）', () => {
    expect(() => computeReminderSchedule(deadline, now, { offsetsDays: [-1] })).toThrow(RangeError)
  })

  it('合法 hourOfDay=0 / 23 正常工作', () => {
    expect(computeReminderSchedule(deadline, now, { hourOfDay: 0, offsetsDays: [1] }))
      .toEqual([iso('2026-11-03T00:00:00+08:00')])
    expect(computeReminderSchedule(deadline, now, { hourOfDay: 23, offsetsDays: [1] }))
      .toEqual([iso('2026-11-03T23:00:00+08:00')])
  })

  it('已整改：合法 hourOfDay=9（默认值）行为不变', () => {
    expect(computeReminderSchedule(deadline, now, { hourOfDay: 9, offsetsDays: [3, 1] }))
      .toEqual([iso('2026-11-01T09:00:00+08:00'), iso('2026-11-03T09:00:00+08:00')])
  })
})

describe('dueReminderPoints · 边界区间 (now-window, now]', () => {
  const deadline = { date: '2026-11-04', precision: 'date' as const, tz: 'Asia/Shanghai' }
  const windowMs = 2 * 60 * 60 * 1000

  it('提醒点恰等于 now → 包含（右闭）', () => {
    // 提醒点 2026-11-01T09:00:00+08:00
    const now = new Date('2026-11-01T09:00:00+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([iso('2026-11-01T09:00:00+08:00')])
  })

  it('提醒点恰等于 now-window → 排除（左开）', () => {
    const now = new Date('2026-11-01T11:00:00+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([])
  })

  it('提醒点比 now-window 晚 1ms → 包含', () => {
    // now-window = 2026-11-01T08:59:59.999+08:00，提醒点 09:00:00.000 严格大于它
    const now = new Date('2026-11-01T10:59:59.999+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([iso('2026-11-01T09:00:00+08:00')])
  })

  it('提醒点比 now-window 早 1ms → 排除', () => {
    const now = new Date('2026-11-01T11:00:00.001+08:00')
    expect(dueReminderPoints(deadline, now, windowMs)).toEqual([])
  })
})

describe('【已整改 SN-07】校验收口在 isValidDeadline，转换器只做纯转换', () => {
  /**
   * 【整改记录 SN-07】
   * 原缺陷：isValidDeadline 要求 date 精度严格为 YYYY-MM-DD（长度 10），
   * 但 getDeadlineInstant/computeReminderSchedule 用 date.slice(0,10) 宽容更长串，
   * 两处契约不一致：同一个值可能被判非法，却被下游函数正常解析。
   * 现整改：契约明确为「isValidDeadline 是写入侧唯一门禁，转换器不做二次校验」，
   * 非法值在门禁被拦截后不会进入下游；以下断言同时锁定「门禁拒绝」与「转换器行为不变」。
   */
  it('已整改：date 精度下更长的串被门禁拒绝，转换器仍按 slice(0,10) 纯转换', () => {
    const d = { date: '2026-11-04T00:00:00+08:00', precision: 'date' as const, tz: 'Asia/Shanghai' }
    expect(isValidDeadline(d)).toBe(false)
    expect(getDeadlineInstant(d).toISOString()).toBe(iso('2026-11-04T23:59:59+08:00'))
  })
})
