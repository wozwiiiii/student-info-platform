/** 众包投稿写操作校验（spec B5） */
import { z } from 'zod'

/**
 * 投稿链接安全性校验（整改记录 SN-09）。
 *
 * 依据：api-submission 会在**服务端** `fetchText(sub.url)` 抓取用户提交的地址
 * （api-submission/src/index.ts 的 reviewSubmission），因此该 URL 是 SSRF 面。
 * zod 的 `.url()` 只校验可解析性，不限协议也不看网段（实测 ftp: / javascript: /
 * file: / http://127.0.0.1 / http://169.254.169.254 全部通过），必须额外收紧：
 *  1. 只允许 http / https；
 *  2. 拒绝环回、链路本地、私网、组播等非公网地址，以及 localhost / *.local / *.internal。
 */
function isPublicHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return false
  }

  // IPv6 环回 / 链路本地 / 唯一本地地址
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return false
  }

  // IPv4 点分十进制：环回 / 0.0.0.0 / 私网 / 链路本地 / 组播 / 保留段
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (v4.slice(1).some((n) => Number(n) > 255)) return false
    if (a === 0 || a === 127) return false // 本机/环回
    if (a === 10) return false // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false // 172.16.0.0/12
    if (a === 192 && b === 168) return false // 192.168.0.0/16
    if (a === 169 && b === 254) return false // 169.254.0.0/16（含云元数据 169.254.169.254）
    if (a >= 224) return false // 组播与保留
  }
  return true
}

export const submissionCreateSchema = z.object({
  url: z
    .string()
    .trim()
    .max(1000)
    .refine(isPublicHttpUrl, { message: 'url 须为公网 http/https 链接（不接受内网/环回/元数据地址与其他协议）' }),
  sourceChannel: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional()
})

export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>
