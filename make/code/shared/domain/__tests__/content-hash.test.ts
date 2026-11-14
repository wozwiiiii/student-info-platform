import { describe, expect, it } from 'vitest'
import { computeContentHash, normalizeTitle } from '../content-hash'
import { sha256Hex } from '../sha256'

/**
 * SHA-256 正确性验证。
 * 期望值由 Node 的 `crypto.createHash('sha256').update(s,'utf8').digest('hex')` 生成后硬编码
 * （本工程未安装 @types/node，测试里无法直接 import node:crypto）。
 * 覆盖：空串、ASCII、UTF-8 中文、emoji（代理对）、以及 55/56/57/63/64/65/119/120 字节
 * 这些**填充与分块边界**——SHA-256 最容易出错的地方。
 */
describe('sha256Hex · 与标准实现（Node crypto）对拍', () => {
  const vectors: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['x', '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881'],
    ['关于 2026 年竞赛的通知', 'daeab561b86234a8dabbea8fc95da5a21eecac72aa4cd622c3e192a5f345fd65'],
    ['教务处', 'c2061d17f006552d05fa3ffb030397dcef5aaa098957bd4aab3064fc241b664d'],
    ['🎉 emoji 🇨🇳 中文混合', '991b8635b5827145f61b6e5fc9e432c43083f1bff10ba70104696e434b2adb4c'],
    ['a'.repeat(1000), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'],
    ['z'.repeat(55), '5a383411d906da80612f366cb9b90ae54bcf6e7743b4117ace0884d98cd159ca'],
    ['z'.repeat(56), 'c66a5b692b9a20229733ef8b87cfec52679c86a0c0245643484c46d4dcd82afa'],
    ['z'.repeat(57), 'f7e927f23e3effb6bca2c32a1f94410002a69d21c0b506541c2a08a595be512d'],
    ['z'.repeat(63), '85021e4907c21645631d596eee989bf43c2cd56b074175d5393804dbf1744412'],
    ['z'.repeat(64), '72996563049cc84daa2c3f31fd5c3d10770e69d6ebbb8da5b6d76db303dbae43'],
    ['z'.repeat(65), '57685f5e43ddac1567f4d404c357c44bab70744b8b6af6009760389170c5c062'],
    ['z'.repeat(119), 'de05957e72aca438f9b0c770cb2ee7fa0e58e08eb54536478db136d54c097abb'],
    ['z'.repeat(120), '46a063da7dc0c878899dfc50adf2558256652c05dd1afc0b1341f7608c7a4776']
  ]

  for (const [input, expected] of vectors) {
    const label = input.length > 24 ? `${input.slice(0, 8)}…(${input.length} 字节)` : input || '(空串)'
    it(`与标准实现一致：${label}`, () => {
      expect(sha256Hex(input)).toBe(expected)
    })
  }
})

describe('normalizeTitle', () => {
  it('去除空白、标点、大小写差异后归一', () => {
    expect(normalizeTitle('  关于 2026 年竞赛的通知！ ')).toBe(normalizeTitle('关于2026年竞赛的通知'))
    expect(normalizeTitle('ABC')).toBe('abc')
    expect(normalizeTitle('a-b_c')).toBe('abc')
  })
})

describe('computeContentHash', () => {
  it('标题归一化 + 来源渠道决定哈希（去重幂等）', () => {
    const a = computeContentHash('【竞赛】报名通知！', '教务处')
    const b = computeContentHash(' 竞赛 报名通知 ', '教务处')
    expect(a).toBe(b)
  })

  it('不同来源渠道不去重', () => {
    const a = computeContentHash('报名通知', '教务处')
    const b = computeContentHash('报名通知', '就业处')
    expect(a).not.toBe(b)
  })

  it('来源渠道大小写与首尾空白归一后相同', () => {
    expect(computeContentHash('报名通知', '  教务处 ')).toBe(computeContentHash('报名通知', '教务处'))
  })

  it('输出为 32 个十六进制字符（SHA-256 截断 128 位）', () => {
    expect(computeContentHash('报名通知', '教务处')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('同输入稳定输出，异输入不同', () => {
    expect(computeContentHash('x', 'y')).toBe(computeContentHash('x', 'y'))
    expect(computeContentHash('x', 'y')).not.toBe(computeContentHash('x', 'z'))
  })
})

describe('SN-10 已整改：SHA-256 消除原 32 位 FNV-1a 碰撞', () => {
  /**
   * 整改前：`竞赛通知72vu` 与 `竞赛通知euea` 归一化后不同，但 32 位 FNV-1a 同为
   * `6c90a521`，后者会被当成重复而丢弃（实测穷举 692,579 次命中）。
   * 整改后：改为 SHA-256 截断 128 位，二者哈希不同，均可正常入库。
   * 本用例同时作为回归锚点：若将来哈希算法再被改弱，这里会立刻变红。
   */
  it('原碰撞对现在产生不同哈希', () => {
    const a = computeContentHash('竞赛通知72vu', '教务处')
    const b = computeContentHash('竞赛通知euea', '教务处')
    expect(a).not.toBe(b)
    // 二者确实是不同的信息标题
    expect(normalizeTitle('竞赛通知72vu')).not.toBe(normalizeTitle('竞赛通知euea'))
  })

  it('不再存在 32 位 FNV-1a 的固定输出（算法已替换）', () => {
    expect(computeContentHash('竞赛通知72vu', '教务处')).not.toBe('6c90a521')
    expect(computeContentHash('竞赛通知euea', '教务处')).not.toBe('6c90a521')
  })
})

describe('【缺陷 SN-11·未整改】归一化后为空的标题仍共享同一哈希', () => {
  /**
   * 这不是哈希算法的问题，而是 normalizeTitle 的语义：它去掉全部空白/标点/符号，
   * 纯符号标题归一化结果为空串，送入哈希前的原文就已相同，因此必然同哈希。
   * 严重度【低】，本轮（高危+中危）范围外，保留为已知问题。
   * 期望（后续）：schema 层要求 normalizeTitle(title) 非空，否则拒绝录入。
   */
  it('当前行为：纯符号标题互相碰撞', () => {
    const a = computeContentHash('！！！', '教务处')
    const b = computeContentHash('？？？', '教务处')
    const c = computeContentHash('---', '教务处')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('当前行为：空标题与纯符号标题同样碰撞', () => {
    expect(computeContentHash('', '教务处')).toBe(computeContentHash('！！！', '教务处'))
  })
})
