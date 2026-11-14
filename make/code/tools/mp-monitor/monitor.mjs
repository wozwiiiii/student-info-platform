#!/usr/bin/env node
/**
 * B1 公众号半自动监控（本机运行，不部署；AGENT.md 2.1 / R9）
 *
 * 【客观事实】微信不开放公众号读取能力，本工具只能做「半自动」：
 *   通道一 fetch：抓取单篇公众号文章页（mp.weixin.qq.com 文章为服务端渲染，可直接 GET）；
 *   通道二 add  ：页面抓取失效时人工粘贴标题/链接/正文（降级可运行，R9）；
 *   通道三     ：即使本工具整体下线，管理后台人工补录始终可用，主链路不受影响。
 * 【假设】文章页 DOM 结构（og:title / js_content / var ct）可能随微信改版变化，
 *   解析采用启发式；失效时请走 add 通道或后台人工补录。
 *
 * 产物：monitor-artifacts/monitor-YYYY-MM-DD.json（schemaVersion 1），
 *   可在管理后台「监控产物导入」一键导入 → 逐条人工确认类别后进入审核队列。
 *   「半自动 + 人工确认后入库」即 B1 的产品定义。
 *
 * 用法（node 直调，无第三方依赖）：
 *   node monitor.mjs fetch <文章URL> --channel <来源渠道，如 公众号名称> [--out <产物文件>]
 *   node monitor.mjs add --title <标题> --url <原文链接> --channel <来源渠道> [--content-file <正文txt>] [--out <产物文件>]
 *   node monitor.mjs show [--out <产物文件>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_VERSION = 1
const CONTENT_MAX = 20000 // 与 informationCreateSchema.content 上限一致

/* ---------------- CLI 参数解析 ---------------- */

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function usage() {
  console.log(`B1 公众号半自动监控（本机运行，产物供管理后台一键导入）

用法：
  node monitor.mjs fetch <文章URL> --channel <来源渠道> [--out <产物文件>]
  node monitor.mjs add --title <标题> --url <原文链接> --channel <来源渠道> [--content-file <正文txt>] [--out <产物文件>]
  node monitor.mjs show [--out <产物文件>]

说明：
  --out 省略时写入 monitor-artifacts/monitor-YYYY-MM-DD.json（按当天日期追加）
  产物 items 结构与后台导入契约对齐；类别（category）由人工在导入时确认`)
}

/* ---------------- 产物文件读写 ---------------- */

function defaultArtifactPath() {
  const d = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  return path.join(HERE, 'monitor-artifacts', `monitor-${d}.json`)
}

async function loadArtifact(file) {
  try {
    const raw = await readFile(file, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.items)) {
      return parsed
    }
    console.warn(`产物文件结构不符（schemaVersion=${SCHEMA_VERSION}），已重置：${file}`)
    return null
  } catch {
    return null
  }
}

async function appendItems(file, items) {
  const artifact = (await loadArtifact(file)) ?? {
    schemaVersion: SCHEMA_VERSION,
    tool: 'mp-monitor',
    exportedAt: new Date().toISOString(),
    items: []
  }
  for (const item of items) {
    // 同链接去重：后抓取的覆盖旧条目（公众号会改稿）
    const idx = artifact.items.findIndex((it) => it.sourceUrl === item.sourceUrl)
    if (idx >= 0) {
      artifact.items[idx] = item
      console.log(`更新既有条目（同链接）：${item.title}`)
    } else {
      artifact.items.push(item)
      console.log(`新增条目：${item.title}`)
    }
  }
  artifact.exportedAt = new Date().toISOString()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(artifact, null, 2), 'utf-8')
  console.log(`产物已写入：${file}（共 ${artifact.items.length} 条）`)
}

/* ---------------- 文章页解析（启发式，【假设】结构可能随微信改版失效） ---------------- */

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim()
}

function extractArticle(html, url) {
  const title =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /id=["']activity-name["'][^>]*>([^<]+)</i.exec(html)?.[1] ??
    /<title>([^<]+)<\/title>/i.exec(html)?.[1]
  if (!title || !title.trim()) {
    throw new Error('未能从页面解析出标题（页面结构可能已变化），请改用 add 通道人工粘贴')
  }

  // 正文区域：从 js_content 标记到下一个 <script（启发式截取）
  const contentStart = html.search(/id=["']js_content["']/i)
  let content = ''
  if (contentStart >= 0) {
    const contentEnd = html.indexOf('<script', contentStart)
    content = stripTags(html.slice(contentStart, contentEnd === -1 ? undefined : contentEnd)).slice(0, CONTENT_MAX)
  }

  // 发布时间：var ct = "秒级时间戳" 或 em#publish_time
  let publishAt = ''
  const ct = /var\s+ct\s*=\s*["'](\d{10})["']/.exec(html)?.[1]
  const publishTime = /<em[^>]+id=["']publish_time["'][^>]*>([^<]+)</i.exec(html)?.[1]
  if (ct) {
    publishAt = new Date(Number(ct) * 1000).toISOString()
  } else if (publishTime && publishTime.trim()) {
    publishAt = publishTime.trim()
  }

  return {
    title: decodeEntities(title.trim()),
    content,
    summary: content.slice(0, 200),
    publishAt
  }
}

async function fetchArticle(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
    return await res.text()
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`抓取文章失败：${reason}（可改用 add 通道人工粘贴，或后台人工补录，R9 降级）`)
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 子命令 ---------------- */

function buildItem({ title, sourceUrl, sourceChannel, content, publishAt }) {
  if (!title?.trim()) throw new Error('缺少标题')
  if (!/^https?:\/\//.test(sourceUrl ?? '')) throw new Error('缺少以 http(s):// 开头的原文链接')
  if (!sourceChannel?.trim()) throw new Error('缺少来源渠道（不做无来源信息）')
  return {
    title: title.trim(),
    sourceUrl: sourceUrl.trim(),
    sourceChannel: sourceChannel.trim(),
    sourceType: 'wechat_mp',
    summary: (content ?? '').slice(0, 200),
    content: (content ?? '').slice(0, CONTENT_MAX),
    publishAt: publishAt ?? '',
    fetchedAt: new Date().toISOString()
  }
}

async function cmdFetch(flags, positional) {
  const url = positional[0]
  if (!url) throw new Error('用法：fetch <文章URL> --channel <来源渠道>')
  const channel = typeof flags.channel === 'string' ? flags.channel : ''
  const html = await fetchArticle(url)
  const article = extractArticle(html, url)
  const item = buildItem({ ...article, sourceUrl: url, sourceChannel: channel })
  await appendItems(typeof flags.out === 'string' ? flags.out : defaultArtifactPath(), [item])
}

async function cmdAdd(flags) {
  let content = ''
  if (typeof flags['content-file'] === 'string') {
    content = await readFile(flags['content-file'], 'utf-8')
  }
  const item = buildItem({
    title: typeof flags.title === 'string' ? flags.title : '',
    sourceUrl: typeof flags.url === 'string' ? flags.url : '',
    sourceChannel: typeof flags.channel === 'string' ? flags.channel : '',
    content
  })
  await appendItems(typeof flags.out === 'string' ? flags.out : defaultArtifactPath(), [item])
}

async function cmdShow(flags) {
  const file = typeof flags.out === 'string' ? flags.out : defaultArtifactPath()
  const artifact = await loadArtifact(file)
  if (!artifact) {
    console.log(`暂无产物：${file}`)
    return
  }
  console.log(`产物：${file}（${artifact.items.length} 条，导出于 ${artifact.exportedAt}）`)
  artifact.items.forEach((it, i) => {
    console.log(`  [${i}] ${it.title}  ← ${it.sourceChannel}  ${it.sourceUrl}`)
  })
}

/* ---------------- 入口 ---------------- */

const { positional, flags } = parseArgs(process.argv.slice(2))
const command = positional[0]

try {
  switch (command) {
    case 'fetch':
      await cmdFetch(flags, positional.slice(1))
      break
    case 'add':
      await cmdAdd(flags)
      break
    case 'show':
      await cmdShow(flags)
      break
    default:
      usage()
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
}
