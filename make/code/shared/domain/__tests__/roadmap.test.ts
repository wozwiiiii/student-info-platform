import { describe, expect, it } from 'vitest'
import { filterStaleNodes, groupNodesByYearSemester, isNodeStale, ROADMAP_STALE_DAYS } from '../roadmap'
import type { RoadmapNode } from '../../types'

const node = (over: Partial<RoadmapNode> = {}): RoadmapNode => ({
  id: 'n1',
  year: 1,
  semester: 1,
  title: '节点',
  relatedInfoIds: [],
  lastMaintainedAt: '2026-01-01',
  createdAt: '2026-01-01T00:00:00+08:00',
  updatedAt: '2026-01-01T00:00:00+08:00',
  ...over
})

describe('isNodeStale（R8 待维护判定）', () => {
  it('整理日当天结束前不算待维护', () => {
    const now = new Date('2026-06-29T23:59:59+08:00') // 整理日结束 + 179 天
    expect(isNodeStale(node(), now)).toBe(false)
  })

  it('满 staleDays 整天即待维护（边界 >=）', () => {
    const dayEnd = new Date('2026-01-01T23:59:59+08:00').getTime()
    expect(isNodeStale(node(), new Date(dayEnd + ROADMAP_STALE_DAYS * 24 * 60 * 60 * 1000))).toBe(true)
    expect(isNodeStale(node(), new Date(dayEnd + ROADMAP_STALE_DAYS * 24 * 60 * 60 * 1000 - 1))).toBe(false)
  })

  it('自定义 staleDays 生效', () => {
    // 整理日(2026-01-01)结束 + 9.5 天
    const now = new Date('2026-01-11T12:00:00+08:00')
    expect(isNodeStale(node(), now, 9)).toBe(true)
    expect(isNodeStale(node(), now, 10)).toBe(false)
  })

  it('整理日在未来（lastMaintainedAt 晚于 now）不算待维护', () => {
    const now = new Date('2026-01-01T00:00:00+08:00')
    expect(isNodeStale(node({ lastMaintainedAt: '2027-01-01' }), now)).toBe(false)
  })
})

describe('【缺陷 SN-41】isNodeStale 对非法日期/越界 staleDays 无校验，静默产出错误判定', () => {
  /**
   * dayEnd 用 `new Date(`${dateOnly.slice(0,10)}T23:59:59+08:00`)`：
   *  - 非法日期 → Invalid Date → `now - NaN = NaN` → `NaN >= x` 恒为 false
   *  - staleDays 为负 → 阈值变负，凡 now 晚于整理日的节点全被判待维护
   * 两者都不报错、不告警，与 SN-06「非法入参静默丢弃」同源。
   * 期望：入参非法即抛错，避免「节点永远不会被标记待维护」这种静默失效。
   */
  it('当前行为：lastMaintainedAt 非法时恒返回 false（永远不待维护）', () => {
    const now = new Date('2026-12-31T00:00:00+08:00')
    expect(isNodeStale(node({ lastMaintainedAt: 'not-a-date' }), now)).toBe(false)
    expect(isNodeStale(node({ lastMaintainedAt: '' }), now)).toBe(false)
  })

  it('当前行为：staleDays 为负时，凡「now 晚于整理日」的节点全被判待维护', () => {
    const now = new Date('2026-01-01T00:00:00+08:00')
    // 整理日在过去 → 差值为正 ≥ 负阈值 → true
    expect(isNodeStale(node({ lastMaintainedAt: '2025-12-31' }), now, -1)).toBe(true)
    // 整理日在未来 → 差值为负 < 负阈值 → false
    expect(isNodeStale(node({ lastMaintainedAt: '2026-06-01' }), now, -1)).toBe(false)
  })

  it('staleDays=0 时，整理日当天结束之后即待维护', () => {
    expect(isNodeStale(node({ lastMaintainedAt: '2026-01-01' }), new Date('2026-01-01T23:59:59+08:00'), 0)).toBe(true)
    expect(isNodeStale(node({ lastMaintainedAt: '2026-01-01' }), new Date('2026-01-01T23:59:58+08:00'), 0)).toBe(false)
  })

  it('对照：正常输入仍按预期工作', () => {
    const now = new Date('2026-06-29T23:59:59+08:00')
    expect(isNodeStale(node(), now)).toBe(false)
  })
})

describe('filterStaleNodes', () => {
  it('只保留待维护节点', () => {
    const now = new Date('2026-10-31T00:00:00+08:00')
    const fresh = node({ id: 'fresh', lastMaintainedAt: '2026-10-01' })
    const stale = node({ id: 'stale', lastMaintainedAt: '2026-01-01' })
    expect(filterStaleNodes([fresh, stale], now).map((n) => n.id)).toEqual(['stale'])
  })
})

describe('groupNodesByYearSemester', () => {
  it('按学年升序、学期升序分组，组内保持传入顺序', () => {
    const nodes = [
      node({ id: 'a', year: 2, semester: 2 }),
      node({ id: 'b', year: 1, semester: 2 }),
      node({ id: 'c', year: 1, semester: 1 }),
      node({ id: 'd', year: 1, semester: 1 }),
      node({ id: 'e', year: 2, semester: 1 })
    ]
    const groups = groupNodesByYearSemester(nodes)
    expect(groups.map((g) => [g.year, g.semester, g.nodes.map((n) => n.id)])).toEqual([
      [1, 1, ['c', 'd']],
      [1, 2, ['b']],
      [2, 1, ['e']],
      [2, 2, ['a']]
    ])
  })

  it('空列表返回空分组', () => {
    expect(groupNodesByYearSemester([])).toEqual([])
  })

  it('四个学年两个学期均能分组且整体有序', () => {
    const nodes = [
      node({ id: 'x', year: 4, semester: 2 }),
      node({ id: 'y', year: 1, semester: 1 }),
      node({ id: 'z', year: 4, semester: 1 })
    ]
    expect(groupNodesByYearSemester(nodes).map((g) => [g.year, g.semester])).toEqual([
      [1, 1],
      [4, 1],
      [4, 2]
    ])
  })
})
