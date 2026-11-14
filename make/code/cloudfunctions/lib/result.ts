import type { ApiResult } from '../../shared/types'

export function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'ok', data }
}

export function fail<T = never>(code: number, message: string): ApiResult<T> {
  return { code, message, data: null }
}

/** 统一日志（AGENT.md §4.7 关键操作结构化日志） */
export function logError(fn: string, error: unknown): void {
  console.error(JSON.stringify({ fn, error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }))
}
