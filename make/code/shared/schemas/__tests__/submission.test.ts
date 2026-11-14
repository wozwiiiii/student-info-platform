/**
 * submissionCreateSchema 单测（此前无测试覆盖）
 * 命名约定：【已整改 SN-xx】= 缺陷已修复，断言整改后的正确行为（注释保留整改记录）；
 *          【缺陷 SN-xx】= 仍未修复，用例锁定「当前实际行为」，期望行为见测试文档。
 */
import { describe, expect, it } from 'vitest'
import { submissionCreateSchema } from '../submission'

describe('submissionCreateSchema · url 必填且须为可解析 URL', () => {
  it('合法 http/https 链接通过', () => {
    expect(submissionCreateSchema.safeParse({ url: 'https://example.edu/notice/1' }).success).toBe(true)
    expect(submissionCreateSchema.safeParse({ url: 'http://example.edu/notice/1' }).success).toBe(true)
  })

  it('非 URL 字符串与空值拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: '' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({}).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'x'.repeat(1001) }).success).toBe(false)
  })

  it('url 超 1000 字符拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: `https://e.edu/${'a'.repeat(1000)}` }).success).toBe(false)
  })
})

describe('【已整改 SN-09】url 只接受公网 http/https，内网/环回/元数据地址与异协议一律拒绝', () => {
  /**
   * 【整改记录 SN-09】
   * 原缺陷：zod v3 `z.string().url()` 底层为 `new URL()`，仅校验可解析性，
   * 不限定协议、不拒绝内网/环回地址（实测 ftp: / javascript: / file: /
   * http://127.0.0.1 / http://169.254.169.254 全部通过）。而 api-submission 会
   * `fetchText(sub.url)` 在服务端抓取用户提交的 URL，用户可让云函数访问内网/元数据地址（SSRF 面）。
   * 现整改：改用自定义 refine（isPublicHttpUrl），只允许公网 http/https，
   * 拒绝环回/链路本地/私网/组播地址与 localhost / *.local 等主机名。
   */
  it('已整改：ftp / javascript / file 协议被拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: 'ftp://example.edu/a' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false)
  })

  it('已整改：环回 / 私网 / 链路本地 / localhost / .local 地址被拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: 'http://127.0.0.1/x' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://169.254.169.254/latest/meta-data/' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://10.0.0.1/admin' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://192.168.0.1/' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://172.16.0.1/' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://localhost/x' }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'http://x.local/' }).success).toBe(false)
  })

  it('已整改：公网 http/https 通过，错误 message 含「公网 http/https」', () => {
    expect(submissionCreateSchema.safeParse({ url: 'https://example.edu/notice/1' }).success).toBe(true)
    expect(submissionCreateSchema.safeParse({ url: 'http://example.edu/notice/1' }).success).toBe(true)

    const r = submissionCreateSchema.safeParse({ url: 'ftp://example.edu/a' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const text = r.error.issues.map((i) => i.message).join('; ')
      expect(text).toContain('公网 http/https')
    }
  })

  it('已整改：超长（>1000）URL 仍被拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: `https://example.edu/${'a'.repeat(1000)}` }).success).toBe(false)
  })
})

describe('submissionCreateSchema · 选填字段', () => {
  it('sourceChannel / note 选填', () => {
    expect(submissionCreateSchema.safeParse({ url: 'https://e.edu/a' }).success).toBe(true)
    expect(submissionCreateSchema.safeParse({
      url: 'https://e.edu/a',
      sourceChannel: '教务处公众号',
      note: '疑似竞赛报名'
    }).success).toBe(true)
  })

  it('note 超 500 字符拒绝、sourceChannel 超 200 字符拒绝', () => {
    expect(submissionCreateSchema.safeParse({ url: 'https://e.edu/a', note: 'x'.repeat(501) }).success).toBe(false)
    expect(submissionCreateSchema.safeParse({ url: 'https://e.edu/a', sourceChannel: 'x'.repeat(201) }).success).toBe(false)
  })

  it('url 首尾空白被裁剪', () => {
    const r = submissionCreateSchema.parse({ url: '  https://e.edu/a  ' })
    expect(r.url).toBe('https://e.edu/a')
  })
})

describe('【缺陷 SN-03】schema 未覆盖 AI 预审结构，aiPreReview 无 zod 契约', () => {
  /**
   * AGENT.md §3.3：submission.aiPreReview{合法来源, 重复检测}；
   * §4.2 要求所有对外写操作过 zod 校验。
   * 现状：Submission 类型含 aiPreReview，但 schema 不含该字段，
   * 由云函数 api-submission 手工构造，其中 confidence 为硬编码 0.5、
   * duplicateInfoId 从未填写。此处仅锁定 schema 层面的空白。
   */
  it('当前行为：schema 不接受也不校验 aiPreReview（多余字段被剥离）', () => {
    const r = submissionCreateSchema.parse({
      url: 'https://e.edu/a',
      aiPreReview: { legalSource: true, confidence: 1 }
    })
    expect('aiPreReview' in r).toBe(false)
  })
})
