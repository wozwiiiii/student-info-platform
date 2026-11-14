/**
 * wx-server-sdk 测试桩（仅测试用，不随云函数部署）
 * 目的：让 cloudfunctions 处理器可在 Node/vitest 中单测，无需真实云环境。
 * 提供最小内存数据库 + getWXContext + openapi.subscribeMessage.send。
 */
type Doc = Record<string, unknown> & { _id?: string }

const store = new Map<string, Doc[]>()
let idSeq = 1
let currentOpenId = ''
let sendBehavior: (payload: Record<string, unknown>) => { errCode: number; errMsg?: string } = () => ({ errCode: 0 })
export const sentMessages: Array<Record<string, unknown>> = []

function coll(name: string): Doc[] {
  let arr = store.get(name)
  if (!arr) {
    arr = []
    store.set(name, arr)
  }
  return arr
}

function matches(doc: Doc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([k, v]) => doc[k] === v)
}

class Query {
  constructor(private name: string, private query: Record<string, unknown>) {}
  private sortSpec: { field: string; dir: string } | null = null
  private skipN = 0
  private limitN = Infinity

  orderBy(field: string, dir: string) {
    this.sortSpec = { field, dir }
    return this
  }
  skip(n: number) {
    this.skipN = n
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  private exec(): Doc[] {
    let rows = coll(this.name).filter((d) => matches(d, this.query))
    if (this.sortSpec) {
      const { field, dir } = this.sortSpec
      rows = [...rows].sort((a, b) => {
        const av = a[field] as string
        const bv = b[field] as string
        return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === 'desc' ? -1 : 1)
      })
    }
    return rows.slice(this.skipN, this.skipN + this.limitN)
  }
  async get<T>(): Promise<{ data: T[] }> {
    // 真实 wx-server-sdk 走网络反序列化，返回的是独立副本而非库内对象引用。
    // 这里必须 deep clone，否则「读快照后再更新库」类逻辑测不出真实的陈旧快照问题。
    return { data: structuredClone(this.exec()) as unknown as T[] }
  }
  async count(): Promise<{ total: number }> {
    return { total: coll(this.name).filter((d) => matches(d, this.query)).length }
  }
  async update(patch: Record<string, unknown>): Promise<{ stats: { updated: number } }> {
    const rows = this.exec()
    for (const r of rows) Object.assign(r, patch)
    return { stats: { updated: rows.length } }
  }
}

class DocRef {
  constructor(private name: string, private id: string) {}
  async get<T>(): Promise<{ data: T }> {
    const found = coll(this.name).find((d) => d._id === this.id)
    return { data: (found ? structuredClone(found) : null) as unknown as T }
  }
  async update(patch: Record<string, unknown>): Promise<{ stats: { updated: number } }> {
    const found = coll(this.name).find((d) => d._id === this.id)
    if (found) Object.assign(found, patch)
    return { stats: { updated: found ? 1 : 0 } }
  }
}

class Collection {
  constructor(private name: string) {}
  where(query: Record<string, unknown>) {
    return new Query(this.name, query)
  }
  doc(id: string) {
    return new DocRef(this.name, id)
  }
  async add(doc: Record<string, unknown>): Promise<{ _id: string }> {
    const _id = `id_${idSeq++}`
    addCalls.push({ name: this.name, doc })
    if (addBehavior) addBehavior(this.name, doc)
    coll(this.name).push({ ...doc, _id })
    return { _id }
  }
}

export const DYNAMIC_CURRENT_ENV = 'test-env'

/** 记录每次 add 调用，供断言批量写入行为 */
export const addCalls: Array<{ name: string; doc: Record<string, unknown> }> = []
let addBehavior: ((name: string, doc: Record<string, unknown>) => void) | null = null

export function init(_opts?: unknown): void {}

export function database() {
  return { collection: (name: string) => new Collection(name) }
}

export function getWXContext(): { OPENID: string } {
  return { OPENID: currentOpenId }
}

export const openapi = {
  subscribeMessage: {
    async send(payload: Record<string, unknown>) {
      sentMessages.push(payload)
      return sendBehavior(payload)
    }
  }
}

/* ---------- 测试控制 ---------- */
export function __reset(): void {
  store.clear()
  idSeq = 1
  currentOpenId = ''
  sendBehavior = () => ({ errCode: 0 })
  sentMessages.length = 0
  addCalls.length = 0
  addBehavior = null
}
export function __setAddBehavior(fn: ((name: string, doc: Record<string, unknown>) => void) | null): void {
  addBehavior = fn
}
export function __seed(name: string, docs: Array<Record<string, unknown>>): void {
  coll(name).length = 0
  for (const d of docs) coll(name).push({ ...d, _id: (d._id as string) ?? `id_${idSeq++}` })
}
export function __rows(name: string): Doc[] {
  return coll(name)
}
export function __setOpenId(id: string): void {
  currentOpenId = id
}
export function __setSendBehavior(fn: (payload: Record<string, unknown>) => { errCode: number; errMsg?: string }): void {
  sendBehavior = fn
}

export default {
  init,
  database,
  getWXContext,
  openapi,
  DYNAMIC_CURRENT_ENV
}
