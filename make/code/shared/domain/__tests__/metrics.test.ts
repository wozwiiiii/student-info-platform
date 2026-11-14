import { describe, expect, it } from 'vitest'
import { buildMetricsSnapshot, safeRate } from '../metrics'

const raw = (over: Partial<Parameters<typeof buildMetricsSnapshot>[0]> = {}) => ({
  weeklyActiveUsers: 20,
  totalUsers: 50,
  reachableSubscribers: 5,
  reminderPushed: 10,
  reminderOpens: 3,
  submissionsTotal: 8,
  submissions7d: 2,
  corrections: 1,
  publishes: 10,
  ...over
})

describe('safeRate', () => {
  it('分母为 0 返回 null（看板显示「—」，不以 0 误导）', () => {
    expect(safeRate(0, 0)).toBeNull()
    expect(safeRate(3, 0)).toBeNull()
  })

  it('四舍五入到 4 位小数', () => {
    expect(safeRate(1, 3)).toBe(0.3333)
    expect(safeRate(5, 20)).toBe(0.25)
  })

  it('分子为 0 但分母为正 → 返回 0（不是 null）', () => {
    expect(safeRate(0, 10)).toBe(0)
  })

  it('分母为负同样返回 null（口径未区分负分母）', () => {
    expect(safeRate(1, -1)).toBeNull()
  })
})

describe('【缺陷 SN-40】safeRate 不拒绝负分子/非有限值，可产出负比率或 NaN', () => {
  /**
   * 指标口径（§6 验证指标）隐含「计数非负」，但 safeRate 只判 denominator<=0。
   * 负分子会算出负比率并直接进看板；NaN/Infinity 会原样透传。
   * 现实触发面：云函数聚合 count 时若过滤条件写反或取到未定义字段，可能出现负值/NaN。
   * 期望：入参非有限或为负时抛错/归一为 null，而不是把异常值送进看板。
   */
  it('当前行为：负分子产出负比率', () => {
    expect(safeRate(-1, 10)).toBe(-0.1)
  })

  it('当前行为：NaN 分子透传为 NaN', () => {
    expect(Number.isNaN(safeRate(NaN, 10) as number)).toBe(true)
  })

  it('当前行为：分子大于分母可产出 >1 的比率（如打开率 150%）', () => {
    expect(safeRate(15, 10)).toBe(1.5)
  })
})

describe('buildMetricsSnapshot · 原始计数透传', () => {
  it('原始计数原样保留，便于看板展示绝对值', () => {
    const snap = buildMetricsSnapshot(raw())
    expect(snap.totalUsers).toBe(50)
    expect(snap.reachableSubscribers).toBe(5)
    expect(snap.reminderOpens).toBe(3)
    expect(snap.submissions7d).toBe(2)
    expect(snap.corrections).toBe(1)
  })
})

describe('buildMetricsSnapshot（KPI 口径唯一定义）', () => {
  it('订阅率 = 可触达订阅者 / 周活', () => {
    const snap = buildMetricsSnapshot(raw())
    expect(snap.subscribeRate).toBe(0.25)
  })

  it('打开率 = 打开数 / 推送成功数', () => {
    const snap = buildMetricsSnapshot(raw())
    expect(snap.openRate).toBe(0.3)
  })

  it('纠错率 = 纠错动作数 / 发布动作数', () => {
    const snap = buildMetricsSnapshot(raw())
    expect(snap.correctionRate).toBe(0.1)
  })

  it('分母为 0 的比率返回 null，原始计数原样保留', () => {
    const snap = buildMetricsSnapshot(raw({
      weeklyActiveUsers: 0,
      reminderPushed: 0,
      publishes: 0
    }))
    expect(snap.subscribeRate).toBeNull()
    expect(snap.openRate).toBeNull()
    expect(snap.correctionRate).toBeNull()
    expect(snap.weeklyActiveUsers).toBe(0)
    expect(snap.submissionsTotal).toBe(8)
  })
})
