/**
 * miniprogram/src/utils/format.ts 单测（P3）
 * 纯函数、无 Taro 依赖，可直接进 vitest（页面/组件按 AGENT.md §4.8 不强制 E2E）。
 * 重点：Asia/Shanghai 展示换算、精度区分、倒计时文案。
 */
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS,
  formatCountdown,
  formatDeadline,
  formatIsoToShanghai,
  ROADMAP_SEMESTER_LABELS,
  ROADMAP_YEAR_LABELS,
  SOURCE_TYPE_LABELS,
  SUBTYPE_LABELS
} from '../format'

describe('标签映射表', () => {
  it('四类信息类别中文标签齐备', () => {
    expect(CATEGORY_LABELS).toEqual({
      opportunity: '机会成长', scholarship: '奖助评优', academic: '教务通知', lecture: '讲座活动'
    })
  })

  it('子类 / 来源 / 路线图标签齐备', () => {
    expect(SUBTYPE_LABELS.competition).toBe('竞赛')
    expect(SUBTYPE_LABELS.job_internship).toBe('就业实习')
    expect(SOURCE_TYPE_LABELS.wechat_mp).toBe('公众号')
    expect(SOURCE_TYPE_LABELS.user_submission).toBe('投稿')
    expect(ROADMAP_YEAR_LABELS[1]).toBe('大一')
    expect(ROADMAP_YEAR_LABELS[4]).toBe('大四')
    expect(ROADMAP_SEMESTER_LABELS[1]).toBe('秋季学期')
  })
})

describe('formatIsoToShanghai（展示统一 Asia/Shanghai）', () => {
  it('空值 / 非法值返回空串', () => {
    expect(formatIsoToShanghai()).toBe('')
    expect(formatIsoToShanghai('')).toBe('')
    expect(formatIsoToShanghai('not-a-date')).toBe('')
    expect(formatIsoToShanghai('2026-13-45T99:99:99Z')).toBe('')
  })

  it('Z 结尾时间戳按 +8 换算（跨日边界正确）', () => {
    // UTC 2026-11-03 16:05 → 东八区 2026-11-04 00:05
    expect(formatIsoToShanghai('2026-11-03T16:05:00.000Z')).toBe('2026-11-04 00:05')
    // UTC 2026-11-03 15:59 → 东八区 2026-11-03 23:59
    expect(formatIsoToShanghai('2026-11-03T15:59:00.000Z')).toBe('2026-11-03 23:59')
  })

  it('输出格式为 YYYY-MM-DD HH:mm（精确到分钟）', () => {
    expect(formatIsoToShanghai('2026-11-03T04:00:00.000Z')).toBe('2026-11-03 12:00')
    expect(formatIsoToShanghai('2026-11-03T04:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('formatDeadline（区分 date / datetime 精度）', () => {
  it('无 deadline 返回空串', () => {
    expect(formatDeadline()).toBe('')
    expect(formatDeadline(undefined)).toBe('')
  })

  it('date 精度只显示日期', () => {
    expect(formatDeadline({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' })).toBe('2026-11-04')
  })

  it('datetime 精度带 +08:00 时直接取本地串（避免二次换算）', () => {
    expect(formatDeadline({ date: '2026-11-04T18:30:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' }))
      .toBe('2026-11-04 18:30')
  })

  it('datetime 精度带 Z 时按 +8 换算', () => {
    expect(formatDeadline({ date: '2026-11-04T10:30:00.000Z', precision: 'datetime', tz: 'Asia/Shanghai' }))
      .toBe('2026-11-04 18:30')
  })
})

describe('formatCountdown（A3 日历倒计时）', () => {
  const now = new Date('2026-11-01T10:00:00+08:00')

  it('无 deadline 返回空串', () => {
    expect(formatCountdown(undefined, now)).toBe('')
  })

  it('已过截止时刻返回「已截止」', () => {
    expect(formatCountdown({ date: '2026-10-31', precision: 'date', tz: 'Asia/Shanghai' }, now)).toBe('已截止')
    // 恰好等于截止时刻也算已截止
    const exact = new Date('2026-11-04T23:59:59+08:00')
    expect(formatCountdown({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }, exact)).toBe('已截止')
  })

  it('当天截止显示「今天截止」', () => {
    expect(formatCountdown({ date: '2026-11-01', precision: 'date', tz: 'Asia/Shanghai' }, now)).toBe('今天截止')
  })

  it('未来截止显示「剩 N 天」', () => {
    // now=2026-11-01 10:00(+08)；date 精度的截止时刻为当天 23:59:59
    // 11-04 截止 → 剩 3 天 13:59:59 → ceil = 4
    expect(formatCountdown({ date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' }, now)).toBe('剩 4 天')
    // 11-11 截止 → 剩 10 天 13:59:59 → ceil = 11
    expect(formatCountdown({ date: '2026-11-11', precision: 'date', tz: 'Asia/Shanghai' }, now)).toBe('剩 11 天')
  })

  it('当前实现按「剩余时长向上取整」计天（客观记录，非按日历日差）', () => {
    // now = 11-01 10:00，deadline = 11-02 23:59:59 → 剩余约 1.58 天 → ceil = 2
    // 说明：对 date 精度的截止，倒计时比「相隔的日历天数」多 1，展示上需知悉这一口径。
    expect(formatCountdown({ date: '2026-11-02', precision: 'date', tz: 'Asia/Shanghai' }, now)).toBe('剩 2 天')
  })

  it('datetime 精度同样参与倒计时', () => {
    expect(formatCountdown({ date: '2026-11-01T18:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' }, now))
      .toBe('今天截止')
    expect(formatCountdown({ date: '2026-11-01T08:00:00+08:00', precision: 'datetime', tz: 'Asia/Shanghai' }, now))
      .toBe('已截止')
  })
})
