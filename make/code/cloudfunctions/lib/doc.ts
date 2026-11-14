import type { Information } from '../../shared/types'

/** 云数据库 information 文档形态（_id 由云端生成） */
export type InfoDoc = Omit<Information, 'id'> & { _id?: string }

export function nowIso(): string {
  return new Date().toISOString()
}
