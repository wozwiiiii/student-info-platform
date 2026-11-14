/**
 * 通用类型定义（三方共用：小程序 / 云函数 / 管理后台）
 * 时间一律 ISO 8601 字符串存储，展示层再格式化（AGENT.md §3.3 时间规则）
 */

/** ISO 8601 时间字符串，如 2026-10-28T09:00:00+08:00 */
export type IsoDateTime = string

/** 仅日期字符串，如 2026-10-28 */
export type IsoDate = string

/** 截止时间：独立建模，区分「仅日期 / 含时刻」精度（产品原则：截止时间是第一公民） */
export interface DeadlineInfo {
  /** precision=date 时为 IsoDate；precision=datetime 时为 IsoDateTime */
  date: IsoDate | IsoDateTime
  precision: 'date' | 'datetime'
  /** 固定 Asia/Shanghai（中国高校场景，无夏令时） */
  tz: string
}

/** 信息来源类型（AGENT.md §3.3：不做无来源信息） */
export type SourceType = 'wechat_mp' | 'official_site' | 'user_submission' | 'manual'

/** 统一接口返回（AGENT.md §4.7） */
export interface ApiResult<T> {
  code: number
  message: string
  data: T | null
}
