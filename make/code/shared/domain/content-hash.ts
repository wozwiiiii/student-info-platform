/**
 * 去重哈希（AGENT.md §4.5 幂等与去重）
 * contentHash = sha256(normalized(title) + '|' + normalized(sourceChannel))
 *
 * 【整改记录 SN-10】原实现为 32 位 FNV-1a，实测穷举 692,579 个标题即命中碰撞对
 * （"竞赛通知72vu" / "竞赛通知euea" 同为 6c90a521），两条不同信息会被误判重复而丢弃；
 * 按生日问题约 7.7 万条碰撞概率达 50%。现改为 SHA-256 截断 128 位。
 *
 * 【注意】contentHash 是 information 的唯一索引，算法变更后**历史值全部失效**：
 * 存量数据需重算（用相同 title/sourceChannel 重新 computeContentHash 覆盖），
 * 否则新写入会与旧值比不上而重复入库。
 */
import { sha256Hex } from './sha256'

/** 截断位数：SHA-256 取前 128 位（32 个十六进制字符） */
const HASH_LENGTH = 32

/** 标题归一化：去空白、去中英文标点与符号、转小写 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 去重哈希：SHA-256 截断 128 位 */
export function computeContentHash(title: string, sourceChannel: string): string {
  return sha256Hex(`${normalizeTitle(title)}|${sourceChannel.trim().toLowerCase()}`).slice(0, HASH_LENGTH)
}
