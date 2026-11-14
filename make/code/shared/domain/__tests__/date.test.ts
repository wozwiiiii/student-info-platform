/**
 * shared/domain/date.ts 单测（P3）
 * 该模块是「真实日历校验 + 东八区口径」的唯一实现，被 deadline / roadmap schema 与
 * api-admin 的指标看板共用，因此单独补齐单测（此前仅被间接覆盖）。
 */
import { describe, expect, it } from 'vitest'
import {
  isValidCalendarDate,
  isValidIsoDateTimeWithOffset,
  shanghaiDateOf,
  SHANGHAI_OFFSET_MS,
  todayShanghaiDate
} from '../date'

describe('isValidCalendarDate（真实日历校验，SN-08/SN-39 整改点）', () => {
  it('合法日期通过', () => {
    for (const d of ['2026-01-01', '2026-12-31', '2026-02-28', '2028-02-29', '2000-02-29']) {
      expect(isValidCalendarDate(d)).toBe(true)
    }
  })

  it('不存在的日历日期拒绝（V8 会顺延，必须自己拦）', () => {
    for (const d of ['2026-02-30', '2026-04-31', '2026-06-31', '2026-02-29', '1900-02-29']) {
      expect(isValidCalendarDate(d)).toBe(false)
    }
  })

  it('闰年规则：4 年一闰、百年不闰、四百年再闰', () => {
    expect(isValidCalendarDate('2024-02-29')).toBe(true) // 4 的倍数
    expect(isValidCalendarDate('2100-02-29')).toBe(false) // 百年不闰
    expect(isValidCalendarDate('2000-02-29')).toBe(true) // 400 的倍数再闰
    expect(isValidCalendarDate('2026-02-29')).toBe(false) // 平年
  })

  it('月份越界拒绝', () => {
    expect(isValidCalendarDate('2026-00-10')).toBe(false)
    expect(isValidCalendarDate('2026-13-01')).toBe(false)
    expect(isValidCalendarDate('2026-99-01')).toBe(false)
  })

  it('日域为 0 或超上限拒绝', () => {
    expect(isValidCalendarDate('2026-01-00')).toBe(false)
    expect(isValidCalendarDate('2026-01-32')).toBe(false)
    expect(isValidCalendarDate('2026-04-31')).toBe(false)
  })

  it('格式不合法拒绝（含带时间串、非补零、空串）', () => {
    expect(isValidCalendarDate('2026-11-04T00:00:00+08:00')).toBe(false)
    expect(isValidCalendarDate('2026-1-4')).toBe(false)
    expect(isValidCalendarDate('')).toBe(false)
    expect(isValidCalendarDate('not-a-date')).toBe(false)
    expect(isValidCalendarDate('2026/11/04')).toBe(false)
    expect(isValidCalendarDate('20261104')).toBe(false)
  })

  it('每月天数边界正确', () => {
    expect(isValidCalendarDate('2026-01-31')).toBe(true) // 31 天月
    expect(isValidCalendarDate('2026-04-30')).toBe(true) // 30 天月
    expect(isValidCalendarDate('2026-04-31')).toBe(false)
  })
})

describe('isValidIsoDateTimeWithOffset（SN-05 整改点）', () => {
  it('必须带显式时区偏移', () => {
    expect(isValidIsoDateTimeWithOffset('2026-11-04T18:00:00+08:00')).toBe(true)
    expect(isValidIsoDateTimeWithOffset('2026-11-04T18:00:00Z')).toBe(true)
    expect(isValidIsoDateTimeWithOffset('2026-11-04T18:00:00-05:00')).toBe(true)
  })

  it('无偏移裸串拒绝', () => {
    expect(isValidIsoDateTimeWithOffset('2026-11-04T18:00:00')).toBe(false)
    expect(isValidIsoDateTimeWithOffset('2026-11-04')).toBe(false)
  })

  it('日期部分同样做日历校验（SN-08 补齐项）', () => {
    expect(isValidIsoDateTimeWithOffset('2026-02-30T10:00:00+08:00')).toBe(false)
    expect(isValidIsoDateTimeWithOffset('2026-04-31T10:00:00Z')).toBe(false)
    expect(isValidIsoDateTimeWithOffset('2026-02-29T10:00:00+08:00')).toBe(false)
    expect(isValidIsoDateTimeWithOffset('2028-02-29T10:00:00+08:00')).toBe(true)
  })

  it('无法解析的串拒绝', () => {
    expect(isValidIsoDateTimeWithOffset('not-a-date+08:00')).toBe(false)
    expect(isValidIsoDateTimeWithOffset('')).toBe(false)
  })
})

describe('todayShanghaiDate / shanghaiDateOf（东八区口径）', () => {
  it('常量为 8 小时毫秒', () => {
    expect(SHANGHAI_OFFSET_MS).toBe(8 * 60 * 60 * 1000)
  })

  it('UTC 时刻换算成东八区日期（跨日边界）', () => {
    // UTC 2026-11-03 16:00 = 东八区 2026-11-04 00:00
    expect(shanghaiDateOf('2026-11-03T16:00:00.000Z')).toBe('2026-11-04')
    // UTC 2026-11-03 15:59 = 东八区 2026-11-03 23:59
    expect(shanghaiDateOf('2026-11-03T15:59:00.000Z')).toBe('2026-11-03')
  })

  it('接受 Date 与字符串两种入参', () => {
    const d = new Date('2026-11-03T16:00:00.000Z')
    expect(shanghaiDateOf(d)).toBe('2026-11-04')
    expect(shanghaiDateOf('2026-11-03T16:00:00.000Z')).toBe('2026-11-04')
  })

  it('todayShanghaiDate 用给定时刻推当天（东八区）', () => {
    expect(todayShanghaiDate(new Date('2026-11-03T16:00:00.000Z'))).toBe('2026-11-04')
    expect(todayShanghaiDate(new Date('2026-11-03T15:00:00.000Z'))).toBe('2026-11-03')
  })

  it('输出格式恒为 YYYY-MM-DD', () => {
    expect(todayShanghaiDate(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(shanghaiDateOf(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
