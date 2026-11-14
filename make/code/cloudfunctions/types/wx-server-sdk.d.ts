/** wx-server-sdk 最小类型声明（仅覆盖本项目用到的 API 面） */
declare module 'wx-server-sdk' {
  export interface QueryRef {
    get<T = unknown>(): Promise<{ data: T[] }>
    count(): Promise<{ total: number }>
    update(data: Record<string, unknown>): Promise<{ stats: { updated: number } }>
    orderBy(field: string, direction: 'asc' | 'desc'): QueryRef
    skip(n: number): QueryRef
    limit(n: number): QueryRef
  }

  export interface DocRef {
    get<T = unknown>(): Promise<{ data: T }>
    update(data: Record<string, unknown>): Promise<{ stats: { updated: number } }>
    set(data: Record<string, unknown>): Promise<unknown>
    remove(): Promise<{ stats: { removed: number } }>
  }

  export interface CollectionRef {
    doc(id: string): DocRef
    add(data: Record<string, unknown>): Promise<{ _id: string }>
    where(query: Record<string, unknown>): QueryRef
    orderBy(field: string, direction: 'asc' | 'desc'): QueryRef
    skip(n: number): QueryRef
    limit(n: number): QueryRef
    count(): Promise<{ total: number }>
  }

  export interface CloudDatabase {
    collection(name: string): CollectionRef
  }

  export interface SubscribeMessageSendOptions {
    touser: string
    template_id: string
    page?: string
    data: Record<string, { value: string }>
    miniprogram_state?: 'developer' | 'trial' | 'formal'
  }

  export interface OpenApiResult {
    errCode: number
    errMsg: string
  }

  export interface Cloud {
    init(options?: { env?: unknown }): void
    database(): CloudDatabase
    getWXContext(): { OPENID: string; APPID: string; UNIONID?: string }
    openapi: {
      subscribeMessage: {
        send(options: SubscribeMessageSendOptions): Promise<OpenApiResult>
      }
    }
    DYNAMIC_CURRENT_ENV: unknown
  }

  const cloud: Cloud
  export default cloud
}
