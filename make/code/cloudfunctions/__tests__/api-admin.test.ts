/**
 * api-admin 处理器测试（阶段二）
 * 重点：写操作校验、发布门禁、审核状态机、审计留痕。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../api-admin/src/index'
import { computeContentHash } from '../../shared/domain'
import { __reset, __rows, __seed, __setAddBehavior } from '../__mocks__/wx-server-sdk'

type R = { code: number; message: string; data: Record<string, unknown> | null }

const call = (action: string, payload: Record<string, unknown>) =>
  main({ action, payload }) as Promise<R>

const infoDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'info_1',
  title: '2026 年程序设计竞赛报名通知',
  category: 'opportunity',
  subType: 'competition',
  deadline: { date: '2026-11-04', precision: 'date', tz: 'Asia/Shanghai' },
  deadlineVerifiedByHuman: false,
  sourceUrl: 'https://example.edu/notice/1',
  sourceChannel: '教务处',
  sourceType: 'official_site',
  contentHash: 'abcdef01',
  reviewStatus: 'pending_review',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...over
})

const createPayload = (over: Record<string, unknown> = {}) => ({
  title: '2026 年程序设计竞赛报名通知',
  category: 'opportunity',
  sourceType: 'official_site',
  sourceChannel: '教务处',
  ...over
})

beforeEach(() => {
  __reset()
})

describe('info.create', () => {
  it('校验通过后落库，状态为 pending_review', async () => {
    const res = await call('info.create', createPayload())
    expect(res.code).toBe(0)
    expect(res.data?.duplicate).toBe(false)
    const doc = __rows('information')[0]
    expect(doc?.reviewStatus).toBe('pending_review')
    expect(doc?.contentHash).toBeTypeOf('string')
    expect(doc?.deadlineVerifiedByHuman).toBe(false)
  })

  it('缺来源返回 400（AGENT.md §4.4）', async () => {
    const res = await call('info.create', createPayload({ sourceChannel: '' }))
    expect(res.code).toBe(400)
    expect(__rows('information')).toHaveLength(0)
  })

  it('重复 contentHash 幂等返回既有条目而非报错（§4.5）', async () => {
    // 预置一条与待创建条目同标题 + 同渠道的记录，使 contentHash 必然相同
    const hash = computeContentHash('2026 年程序设计竞赛报名通知', '教务处')
    __seed('information', [infoDoc({ contentHash: hash })])
    const res = await call('info.create', createPayload())
    expect(res.code).toBe(0)
    expect(res.data?.duplicate).toBe(true)
    expect(__rows('information')).toHaveLength(1)
  })

  it('同标题但不同来源渠道不去重', async () => {
    const hash = computeContentHash('2026 年程序设计竞赛报名通知', '教务处')
    __seed('information', [infoDoc({ contentHash: hash })])
    const res = await call('info.create', createPayload({ sourceChannel: '就业处' }))
    expect(res.data?.duplicate).toBe(false)
    expect(__rows('information')).toHaveLength(2)
  })

  it('未知 action 返回 400', async () => {
    const res = await call('info.nope', {})
    expect(res.code).toBe(400)
  })
})

describe('【已整改 SN-01】创建时自报 deadlineVerifiedByHuman 不再被持久化', () => {
  /**
   * 【整改记录 SN-01】
   * 原缺陷：AGENT.md §4.3 规定该标记语义是「审核员已人工复核截止日期」，
   * 但 informationCreateSchema 接受写入方提交的 true，createInfo 原样持久化，
   * 后续 publish 门禁直接采信此值，无需任何独立复核动作即可满足「已复核」条件。
   * 现整改：schema 不再含该字段（客户端提交被 zod 剥离），写入侧一律置 false，
   * 只有 info.review 审核动作可置 true。
   */
  it('已整改：客户端传 true 不被持久化，落库恒为 false', async () => {
    const res = await call('info.create', createPayload({ deadlineVerifiedByHuman: true }))
    expect(res.code).toBe(0)
    expect(__rows('information')[0]?.deadlineVerifiedByHuman).toBe(false)
  })

  it('已整改：自报 true 无法绕过人工复核直接发布', async () => {
    await call('info.create', createPayload({
      deadlineVerifiedByHuman: true,
      deadline: { date: '2026-11-04', precision: 'date' }
    }))
    expect(__rows('information')[0]?.deadlineVerifiedByHuman).toBe(false)
    const id = __rows('information')[0]?._id as string
    const res = await call('info.review', { id, action: 'publish' })
    expect(res.code).toBe(409)
    expect(res.message).toContain('人工复核')
    expect(__rows('information')[0]?.reviewStatus).toBe('pending_review')
  })
})

describe('info.review · 发布门禁（§4.3 / §4.4）', () => {
  it('deadline 未经人工复核禁止发布', async () => {
    __seed('information', [infoDoc({ deadlineVerifiedByHuman: false })])
    const res = await call('info.review', { id: 'info_1', action: 'publish' })
    expect(res.code).toBe(409)
    expect(res.message).toContain('人工复核')
    expect(__rows('information')[0]?.reviewStatus).toBe('pending_review')
  })

  it('缺少来源禁止发布', async () => {
    __seed('information', [infoDoc({ sourceUrl: '', sourceChannel: '', deadline: undefined, deadlineVerifiedByHuman: true })])
    const res = await call('info.review', { id: 'info_1', action: 'publish' })
    expect(res.code).toBe(409)
    expect(res.message).toContain('来源')
  })

  it('有来源 + 已复核 → 发布成功并写 publishedAt', async () => {
    __seed('information', [infoDoc({ deadlineVerifiedByHuman: true })])
    const res = await call('info.review', { id: 'info_1', action: 'publish' })
    expect(res.code).toBe(0)
    const doc = __rows('information')[0]
    expect(doc?.reviewStatus).toBe('published')
    expect(doc?.publishedAt).toBeTypeOf('string')
  })

  it('payload 显式传 deadlineVerifiedByHuman 可当场解锁发布', async () => {
    __seed('information', [infoDoc({ deadlineVerifiedByHuman: false })])
    const res = await call('info.review', { id: 'info_1', action: 'publish', deadlineVerifiedByHuman: true })
    expect(res.code).toBe(0)
    expect(__rows('information')[0]?.reviewStatus).toBe('published')
  })

  it('非法状态迁移返回 409（collected 不可直接发布）', async () => {
    __seed('information', [infoDoc({ reviewStatus: 'collected', deadlineVerifiedByHuman: true })])
    const res = await call('info.review', { id: 'info_1', action: 'publish' })
    expect(res.code).toBe(409)
    expect(res.message).toContain('非法状态迁移')
  })

  it('reject / correct 合法，且写 review_log', async () => {
    __seed('information', [infoDoc()])
    await call('info.review', { id: 'info_1', action: 'reject' })
    expect(__rows('information')[0]?.reviewStatus).toBe('rejected')
    expect(__rows('review_log')).toHaveLength(1)
    expect(__rows('review_log')[0]?.operator).toBe('admin')
    expect(__rows('review_log')[0]?.infoId).toBe('info_1')
  })

  it('缺少 id / 非法 action 返回 400', async () => {
    __seed('information', [infoDoc()])
    expect((await call('info.review', { action: 'publish' })).code).toBe(400)
    expect((await call('info.review', { id: 'info_1', action: 'nope' })).code).toBe(400)
  })

  it('不存在的条目返回 404', async () => {
    const res = await call('info.review', { id: 'nope', action: 'publish' })
    expect(res.code).toBe(404)
  })
})

describe('【已整改 SN-20】action 合法性改用自有属性判断，非法 action 统一 400', () => {
  /**
   * 【整改记录 SN-20】
   * 原缺陷：api-admin 用 `!(action in ACTION_TO_STATUS)` 校验 action，`in` 会查原型链，
   * 因此 'toString' / 'constructor' 能通过守卫，随后 ACTION_TO_STATUS[action] 取到
   * Object.prototype 上的方法（函数），最终被 canTransition 挡下，
   * 但返回的是 409「非法状态迁移」而非 400。
   * 现整改：改用 Object.prototype.hasOwnProperty 判断自有属性，非法 action 统一 400。
   */
  it('已整改：action=toString 返回 400 而非 409', async () => {
    __seed('information', [infoDoc()])
    const res = await call('info.review', { id: 'info_1', action: 'toString' })
    expect(res.code).toBe(400)
    expect(__rows('information')[0]?.reviewStatus).toBe('pending_review')
  })
})

describe('【已整改 SN-17】info.update 补齐 zod 校验，非法值 400 且不落库', () => {
  /**
   * 【整改记录 SN-17】
   * 原缺陷：AGENT.md §4.2 要求所有对外写操作必须过 zod 校验，但 updateInfo
   * 只做 UPDATABLE_FIELDS 白名单复制，对字段值不作任何校验，
   * 非法 deadline / 空标题 / 超长字段直接落库。
   * 现整改：patch 逐字段过 informationPatchSchema，非法值返回 400 且不落库。
   */
  it('已整改：非法 deadline 与空 title、超长 location 返回 400，不落库', async () => {
    __seed('information', [infoDoc({ deadlineVerifiedByHuman: true })])
    const res = await call('info.update', {
      id: 'info_1',
      patch: { title: '', deadline: { date: 'garbage', precision: 'date' }, location: 'x'.repeat(500) }
    })
    expect(res.code).toBe(400)
    const doc = __rows('information')[0]
    // 未落库：原值保持不变
    expect(doc?.title).toBe('2026 年程序设计竞赛报名通知')
    expect((doc?.deadline as { date: string }).date).toBe('2026-11-04')
    expect(doc?.location).toBeUndefined()
    expect(__rows('review_log')).toHaveLength(0)
  })

  it('已整改：合法 patch 仍正常落库', async () => {
    __seed('information', [infoDoc({ deadlineVerifiedByHuman: true })])
    const res = await call('info.update', { id: 'info_1', patch: { title: '更正后的标题' } })
    expect(res.code).toBe(0)
    expect(__rows('information')[0]?.title).toBe('更正后的标题')
  })
})

describe('【已整改 SN-18】info.update 不再允许来源双双置空', () => {
  /**
   * 【整改记录 SN-18】
   * 原缺陷：§4.4 规定 sourceUrl || sourceChannel 缺失的记录无法进入 published，
   * 但 updateInfo 既不过 zod 也不复跑 checkPublishable，
   * 可把已发布条目的两个来源字段同时清空，而 reviewStatus 仍为 published。
   * 现整改：更新后 sourceUrl 与 sourceChannel 至少一个非空，否则返回 409 且不落库。
   */
  it('已整改：sourceUrl 与 sourceChannel 同时置空返回 409，不落库', async () => {
    __seed('information', [infoDoc({ reviewStatus: 'published', deadlineVerifiedByHuman: true })])
    const res = await call('info.update', { id: 'info_1', patch: { sourceUrl: '', sourceChannel: '' } })
    expect(res.code).toBe(409)
    expect(res.message).toContain('不能同时为空')
    const doc = __rows('information')[0]
    // 不落库：来源原值保持不变，published 状态未被污染
    expect(doc?.sourceUrl).toBe('https://example.edu/notice/1')
    expect(doc?.sourceChannel).toBe('教务处')
    expect(doc?.reviewStatus).toBe('published')
    expect(__rows('review_log')).toHaveLength(0)
  })
})

describe('【已整改 SN-19】改 deadline 后 deadlineVerifiedByHuman 被重置', () => {
  /**
   * 【整改记录 SN-19】
   * 原缺陷：§4.3 / R12 规定截止日期必须人工复核后才可发布，复核标记是对
   * 「某个具体 deadline 值」的背书，但 updateInfo 修改 deadline 时不重置
   * deadlineVerifiedByHuman，旧背书被沿用到新日期上——改期后的截止日期从未被复核却仍可发布。
   * 现整改：修改 deadline 会把 deadlineVerifiedByHuman 重置为 false。
   */
  it('已整改：deadline 改期后 deadlineVerifiedByHuman 被重置为 false', async () => {
    __seed('information', [infoDoc({ reviewStatus: 'published', deadlineVerifiedByHuman: true })])
    await call('info.update', {
      id: 'info_1',
      patch: { deadline: { date: '2027-01-01', precision: 'date', tz: 'Asia/Shanghai' } }
    })
    const doc = __rows('information')[0]
    expect((doc?.deadline as { date: string }).date).toBe('2027-01-01')
    expect(doc?.deadlineVerifiedByHuman).toBe(false)
  })
})

describe('【已整改 SN-21】review_log 补齐 diff 字段，info.update 也写 updated 留痕', () => {
  /**
   * 【整改记录 SN-21】
   * 原缺陷：§3.3 数据模型要求 review_log | infoId, operator(AI/人工), action, diff |
   * 全审核链路可追溯，但实际写入 {infoId, operator:'admin', action, fromStatus, at}：
   * 无 diff（纠错内容不可追溯）。operator 仍为 'admin'（区分 AI/人工不在本次整改范围）。
   * 现整改：review 文档含状态级 diff；info.update 也写一条 action:'updated' 的
   * review_log，含字段级 diff。
   */
  it('已整改：info.review 的 review_log 含 diff', async () => {
    __seed('information', [infoDoc()])
    await call('info.review', { id: 'info_1', action: 'correct' })
    const log = __rows('review_log')[0]
    expect(log).toBeDefined()
    expect('diff' in (log ?? {})).toBe(true)
    const diff = log?.diff as Record<string, { from: unknown; to: unknown }>
    expect(diff.reviewStatus).toEqual({ from: 'pending_review', to: 'corrected' })
    expect(diff.deadlineVerifiedByHuman).toEqual({ from: false, to: false })
    expect(log?.operator).toBe('admin')
  })

  it('已整改：info.update 写 action=updated 的 review_log，含字段级 diff', async () => {
    __seed('information', [infoDoc()])
    await call('info.update', { id: 'info_1', patch: { title: '更正后的标题' } })
    const log = __rows('review_log').find((l) => String(l.action) === 'updated')
    expect(log).toBeDefined()
    const diff = log?.diff as Record<string, { from: unknown; to: unknown }>
    expect(diff.title).toEqual({ from: '2026 年程序设计竞赛报名通知', to: '更正后的标题' })
    expect(log?.infoId).toBe('info_1')
  })
})

describe('info.listAdmin', () => {
  it('按状态过滤并返回分页信息', async () => {
    __seed('information', [
      infoDoc({ _id: 'a', reviewStatus: 'published' }),
      infoDoc({ _id: 'b', reviewStatus: 'pending_review' })
    ])
    const res = await call('info.listAdmin', { status: 'published', page: 1, pageSize: 10 })
    expect(res.code).toBe(0)
    expect((res.data as { total: number }).total).toBe(1)
    expect((res.data as { items: Array<{ id: string }> }).items[0]?.id).toBe('a')
  })
})

/* ===================== 整改验证（既有用例未覆盖的边界） ===================== */

describe('【已整改 SN-43】info.import 写入失败不再整体 500，失败条目并入 invalid 明细', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    title: '2026 年数学建模竞赛报名通知',
    category: 'opportunity',
    sourceType: 'official_site',
    sourceChannel: '教务处',
    ...over
  })

  it('已整改：中途写入失败返回 code 0，成功条目照常导入，失败条目进 invalid', async () => {
    /**
     * 【整改记录 SN-43】
     * 原缺陷：importInfos 顺序循环逐条 insertUniqueInfo，无事务/无回滚。
     * 第 2 条写入抛异常时，第 1 条已落库且不回滚，整体返回 500，调用方无法得知「已导入多少」。
     * 现整改：逐条捕获写入异常，失败条目并入 invalid 明细返回 code 0，
     * 调用方可据实重试（重试经 contentHash 去重天然幂等）。
     */
    __setAddBehavior((_name, doc) => {
      if (doc.title === '第二条') throw new Error('模拟写入失败')
    })
    const res = await call('info.import', {
      items: [item({ title: '第一条' }), item({ title: '第二条' }), item({ title: '第三条' })]
    })
    expect(res.code).toBe(0)
    expect(res.data?.imported).toBe(2) // 第一、三条成功
    const invalid = res.data?.invalid as Array<{ index: number; reason: string }>
    expect(invalid).toHaveLength(1)
    expect(invalid[0]?.index).toBe(1)
    expect(invalid[0]?.reason).toContain('写入失败')
    const rows = __rows('information')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => String(r.title)).sort()).toEqual(['第一条', '第三条'])
    __setAddBehavior(null)
  })
})

describe('【已整改 SN-44】roadmap.update 更新不存在的节点返回 404', () => {
  it('已整改：节点不存在返回 404 而非 ok', async () => {
    const res = await call('roadmap.update', { id: 'not_exist', patch: { title: 'x' } })
    expect(res.code).toBe(404)
    expect(__rows('roadmap_node')).toHaveLength(0)
  })
})

describe('【已整改 SN-42】metrics.dashboard 日期口径统一按 Asia/Shanghai', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Asia/Shanghai 2026-11-01 10:00 → today='2026-11-01'，cutoff='2026-10-26'
    vi.setSystemTime(new Date('2026-11-01T10:00:00+08:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('已整改：窗口边界当天凌晨创建的投稿与活跃同口径计入', async () => {
    /**
     * 【整改记录 SN-42】
     * 原缺陷：today/cutoffDate 由 Asia/Shanghai 推导，但 submissions7d 用
     * `s.createdAt.slice(0,10)`，而 createdAt 是 UTC ISO 串，切片得到 UTC 日期。
     * 后果：Asia/Shanghai 每天 00:00–08:00 创建的投稿，UTC 日期是前一天，
     * 落在 cutoffDate 之前而被漏统计；对照 activity_log.date 存 Asia/Shanghai 日期
     * 却被正确计入——同一张看板上两个口径不一致。
     * 现整改：submissions7d 统一换算成 Asia/Shanghai 日期再比较（与 activity 同口径）。
     */
    // 投稿创建于 Asia/Shanghai 2026-10-26 02:00（窗口边界当天凌晨）
    // → nowIso() 存 '2026-10-25T18:00:00.000Z'，换算东八区日期='2026-10-26' = cutoffDate
    __seed('submission', [{ createdAt: '2026-10-25T18:00:00.000Z' }])
    __seed('activity_log', [{ openId: 'u1', date: '2026-10-26' }])

    const s = (await call('metrics.dashboard', {})).data as Record<string, number>
    expect(s.weeklyActiveUsers).toBe(1) // 活跃计入
    expect(s.submissions7d).toBe(1) // 投稿与活跃同口径，不再被漏统计
    expect(s.submissionsTotal).toBe(1)
  })

  it('对照：窗口正中的投稿被正确计入', async () => {
    // Asia/Shanghai 2026-10-29 12:00 → UTC '2026-10-29T04:00:00.000Z'，slice='2026-10-29'
    __seed('submission', [{ createdAt: '2026-10-29T04:00:00.000Z' }])
    const s = (await call('metrics.dashboard', {})).data as Record<string, number>
    expect(s.submissions7d).toBe(1)
  })
})

describe('info.import（B1 监控产物一键导入）', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    title: '就业双选会通知',
    category: 'opportunity',
    subType: 'job_internship',
    sourceType: 'wechat_mp',
    sourceUrl: 'https://mp.weixin.qq.com/s/abc',
    sourceChannel: '就业指导中心',
    ...over
  })

  it('全部合法时逐条落库为 pending_review，强制 deadlineVerifiedByHuman=false', async () => {
    const res = await call('info.import', { items: [item(), item({ title: '另一条' })] })
    expect(res.code).toBe(0)
    expect(res.data?.imported).toBe(2)
    expect(res.data?.duplicates).toBe(0)
    expect((res.data?.invalid as unknown[]).length).toBe(0)
    const rows = __rows('information')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.reviewStatus === 'pending_review')).toBe(true)
    expect(rows.every((r) => r.deadlineVerifiedByHuman === false)).toBe(true)
  })

  it('非法条目进 invalid 清单，不阻塞合法条目', async () => {
    const res = await call('info.import', {
      items: [item(), item({ title: '', sourceChannel: '' })]
    })
    expect(res.code).toBe(0)
    expect(res.data?.imported).toBe(1)
    const invalid = res.data?.invalid as Array<{ index: number; reason: string }>
    expect(invalid).toHaveLength(1)
    expect(invalid[0]?.index).toBe(1)
    expect(invalid[0]?.reason).toContain('title')
  })

  it('批内与库内重复均计 duplicate（§4.5 幂等去重）', async () => {
    await call('info.import', { items: [item()] })
    const res = await call('info.import', { items: [item(), item({ title: '新条目' })] })
    expect(res.data?.duplicates).toBe(1)
    expect(res.data?.imported).toBe(1)
  })

  it('items 非数组或为空返回 400', async () => {
    expect((await call('info.import', { items: [] })).code).toBe(400)
    expect((await call('info.import', {})).code).toBe(400)
  })
})

describe('roadmap.*（A4 路线图维护 / R8）', () => {
  const nodePayload = (over: Record<string, unknown> = {}) => ({
    year: 1,
    semester: 1,
    title: '英语四级报名',
    typicalWindow: '每年 3 月、9 月',
    lastMaintainedAt: '2026-10-01',
    ...over
  })

  it('roadmap.create：校验通过落库，缺 lastMaintainedAt 返回 400', async () => {
    const res = await call('roadmap.create', nodePayload())
    expect(res.code).toBe(0)
    expect(__rows('roadmap_node')).toHaveLength(1)
    expect(__rows('roadmap_node')[0]?.lastMaintainedAt).toBe('2026-10-01')

    const { lastMaintainedAt: _drop, ...rest } = nodePayload()
    expect((await call('roadmap.create', rest)).code).toBe(400)
  })

  it('roadmap.update：内容字段变更自动刷新 lastMaintainedAt（编辑即整理）', async () => {
    await call('roadmap.create', nodePayload())
    const id = __rows('roadmap_node')[0]?._id as string
    const res = await call('roadmap.update', { id, patch: { title: '英语四级/六级报名' } })
    expect(res.code).toBe(0)
    expect(__rows('roadmap_node')[0]?.lastMaintainedAt).not.toBe('2026-10-01')
  })

  it('roadmap.update：显式 lastMaintainedAt 以传入为准', async () => {
    await call('roadmap.create', nodePayload())
    const id = __rows('roadmap_node')[0]?._id as string
    await call('roadmap.update', { id, patch: { title: '改名', lastMaintainedAt: '2026-11-30' } })
    expect(__rows('roadmap_node')[0]?.lastMaintainedAt).toBe('2026-11-30')
  })

  it('roadmap.update：空 patch 返回 400', async () => {
    await call('roadmap.create', nodePayload())
    const id = __rows('roadmap_node')[0]?._id as string
    expect((await call('roadmap.update', { id, patch: {} })).code).toBe(400)
  })

  it('roadmap.listAdmin：返回 id 映射后的全部节点', async () => {
    await call('roadmap.create', nodePayload())
    await call('roadmap.create', nodePayload({ title: '数学建模竞赛', year: 2, semester: 2 }))
    const res = await call('roadmap.listAdmin', {})
    expect(res.code).toBe(0)
    expect((res.data as { total: number }).total).toBe(2)
    const items = (res.data as { items: Array<Record<string, unknown>> }).items
    expect(items.every((i) => typeof i.id === 'string')).toBe(true)
  })
})

describe('metrics.dashboard（M5 数据看板）', () => {
  const dayStr = (offsetDays: number) =>
    new Date(Date.now() + 8 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  it('聚合各集合计数并按 shared 口径计算比率', async () => {
    const today = dayStr(0)
    __seed('activity_log', [
      { openId: 'a', date: today },
      { openId: 'a', date: today }, // 同人同天重复不重复计
      { openId: 'b', date: dayStr(3) },
      { openId: 'c', date: dayStr(30) } // 超出 7 天窗口
    ])
    __seed('user', [{ openId: 'a' }, { openId: 'b' }, { openId: 'c' }, { openId: 'd' }, { openId: 'e' }])
    __seed('subscribe_record', [
      { openId: 'a', quota: 1 },
      { openId: 'b', quota: 0 },
      { openId: 'c', quota: 1, expireAt: '2020-01-01T00:00:00.000Z' } // 已过期
    ])
    __seed('reminder_log', [
      { status: 'sent' }, { status: 'sent' }, { status: 'failed' }
    ])
    __seed('event_log', [
      { type: 'open_remind' }, { type: 'other' }
    ])
    __seed('submission', [
      { createdAt: `${today}T00:00:00.000Z` },
      { createdAt: `${dayStr(30)}T00:00:00.000Z` },
      {}
    ])
    __seed('review_log', [
      { action: 'corrected' }, { action: 'published' }, { action: 'published' }
    ])

    const res = await call('metrics.dashboard', {})
    expect(res.code).toBe(0)
    const d = res.data as Record<string, number | string | null>
    expect(d.weeklyActiveUsers).toBe(2) // a、b（c 超窗；a 同天去重）
    expect(d.totalUsers).toBe(5)
    expect(d.reachableSubscribers).toBe(1) // 仅 a（b 无余量、c 过期）
    expect(d.subscribeRate).toBe(0.5) // 1 / 2
    expect(d.reminderPushed).toBe(2)
    expect(d.reminderOpens).toBe(1)
    expect(d.openRate).toBe(0.5) // 1 / 2
    expect(d.submissionsTotal).toBe(3)
    expect(d.submissions7d).toBe(1)
    expect(d.corrections).toBe(1)
    expect(d.publishes).toBe(2)
    expect(d.correctionRate).toBe(0.5) // 1 / 2
    expect(String(d.computedAt)).not.toBe('')
  })

  it('空库时比率返回 null 而非 0', async () => {
    const res = await call('metrics.dashboard', {})
    const d = res.data as Record<string, number | string | null>
    expect(d.weeklyActiveUsers).toBe(0)
    expect(d.subscribeRate).toBeNull()
    expect(d.openRate).toBeNull()
    expect(d.correctionRate).toBeNull()
  })
})
