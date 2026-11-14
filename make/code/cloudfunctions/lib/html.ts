/**
 * 轻量 HTML 处理（爬取 B2 / 投稿 B5 共用）
 * 【客观事实】不做 headless 浏览器渲染（云函数不适合重型浏览器）；只处理静态 HTML
 */

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CampusInfoBot/0.1)' }
  })
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
  return await res.text()
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  // stripTags 内部已做实体解码，此处不再重复解码（整改 SN-14）
  return m ? stripTags(m[1] ?? '').trim() : ''
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim()
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'"
}

/**
 * HTML 实体解码（整改 SN-14）。
 *
 * 原实现用链式 .replace()，前一步的替换产物会落进后一步的匹配范围，一次调用内就解码两遍：
 * `&amp;lt;` → `&lt;` → `<`（正确应为字面量 `&lt;`）。实测 `&amp;#39;` 同样级联成单引号。
 * 现改为单趟扫描，不做二次解码。
 */
function decodeEntities(text: string): string {
  return text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole)
}

export interface PageLink {
  url: string
  text: string
}

export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const links: PageLink[] = []
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? ''
    const text = stripTags(m[2] ?? '').trim()
    if (!text) continue
    try {
      const abs = new URL(href, baseUrl)
      if (abs.protocol === 'http:' || abs.protocol === 'https:') {
        links.push({ url: abs.toString(), text })
      }
    } catch {
      // 非法 href 直接跳过
    }
  }
  return links
}
