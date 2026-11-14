/**
 * cloudfunctions/lib 纯函数单测（阶段二）
 * 覆盖 classify.ts / html.ts / result.ts —— 均为无副作用纯函数。
 */
import { describe, expect, it } from 'vitest'
import { classifyByTitle, CRAWL_KEYWORDS } from '../classify'
import { extractLinks, extractTitle, stripTags } from '../html'
import { fail, ok } from '../result'

describe('classifyByTitle', () => {
  it('按关键词优先级归类', () => {
    expect(classifyByTitle('关于保研推免政策的通知')).toEqual({ category: 'opportunity', subType: 'postgrad' })
    expect(classifyByTitle('程序设计竞赛报名通知')).toEqual({ category: 'opportunity', subType: 'competition' })
    expect(classifyByTitle('2026 届春季校园招聘')).toEqual({ category: 'opportunity', subType: 'job_internship' })
    expect(classifyByTitle('国家奖学金评审办法')).toEqual({ category: 'scholarship' })
    expect(classifyByTitle('学术讲座：人工智能前沿')).toEqual({ category: 'lecture' })
  })

  it('无关键词时兜底 academic', () => {
    expect(classifyByTitle('关于调整作息时间的通知')).toEqual({ category: 'academic' })
    expect(classifyByTitle('')).toEqual({ category: 'academic' })
  })

  it('关键词顺序即优先级：保研优先于竞赛', () => {
    expect(classifyByTitle('保研竞赛加分政策')).toEqual({ category: 'opportunity', subType: 'postgrad' })
  })

  it('奖学金优先于活动类词', () => {
    expect(classifyByTitle('奖学金评选活动通知')).toEqual({ category: 'scholarship' })
    expect(classifyByTitle('就业指导活动')).toEqual({ category: 'opportunity', subType: 'job_internship' })
  })

  it('CRAWL_KEYWORDS 只留成长相关条目', () => {
    expect(CRAWL_KEYWORDS.test('关于举办竞赛的通知')).toBe(true)
    expect(CRAWL_KEYWORDS.test('学校食堂菜单')).toBe(false)
  })

  it('CRAWL_KEYWORDS 无 g 标志，test() 无 lastIndex 状态残留', () => {
    // 有 g 标志的正则重复 test() 会交替返回 true/false，此处验证不受影响
    const s = '竞赛报名通知'
    expect(CRAWL_KEYWORDS.test(s)).toBe(true)
    expect(CRAWL_KEYWORDS.test(s)).toBe(true)
  })
})

describe('extractTitle / stripTags', () => {
  it('提取并解码 <title>', () => {
    expect(extractTitle('<html><head><title> 关于&amp;竞赛的通知 </title></head></html>')).toBe('关于&竞赛的通知')
  })

  it('无 title 返回空串', () => {
    expect(extractTitle('<html><body>x</body></html>')).toBe('')
  })

  it('去 script/style/标签并压缩空白', () => {
    expect(stripTags('<style>.a{}</style><script>var x=1</script><p>正文</p><p>第二段</p>')).toBe('正文 第二段')
  })

  it('解码 HTML 实体', () => {
    expect(stripTags('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b')
  })
})

describe('【已整改 SN-14】HTML 实体改为单趟扫描解码，不再级联/重复解码', () => {
  /**
   * 【整改记录 SN-14】
   * 原缺陷（实测）：decodeEntities（html.ts）用链式 .replace() 实现，
   * 前一步的替换产物会落进后一步的匹配范围，导致一次调用内就解码两遍：
   *   '&amp;lt;' → '&amp;'→'&' 得 '&lt;' → '&lt;'→'<' 得 '<'（正确应为字面量 '&lt;'）。
   * 另有第二层问题：extractTitle / extractLinks 在 stripTags（内部已解码）之外
   * 又调一次 decodeEntities，进一步放大失真。
   * 现整改：decodeEntities 改单趟扫描（不级联），extractTitle/extractLinks 外层不再重复解码。
   */
  it('已整改：&amp;lt; 解码为字面量 &lt;（不再级联成 <）', () => {
    expect(stripTags('&amp;lt;')).toBe('&lt;')
    expect(extractTitle('<title>&amp;lt;script&amp;gt;</title>')).toBe('&lt;script&gt;')
  })

  it('已整改：&amp;#39; 解码为字面量 &#39;（不再级联成单引号）', () => {
    expect(stripTags('&amp;#39;')).toBe('&#39;')
  })

  it('对照：&amp;amp; 不级联，只解一层', () => {
    expect(stripTags('&amp;amp;')).toBe('&amp;')
    expect(stripTags('&amp;amp;amp;')).toBe('&amp;amp;')
  })

  it('已整改：外层不再重复解码，&amp;amp;lt; 单层解得 &amp;lt;', () => {
    // stripTags 单层解码 → '&amp;lt;'
    expect(stripTags('&amp;amp;lt;')).toBe('&amp;lt;')
    // extractTitle 不再外层二次解码，仍为 '&amp;lt;'（原来被放大成 '<'）
    expect(extractTitle('<title>&amp;amp;lt;</title>')).toBe('&amp;lt;')
  })

  it('已整改：extractLinks 锚文本同样只解一层', () => {
    const links = extractLinks('<a href="/n">&amp;amp;lt;标注&gt;</a>', 'https://example.edu/list')
    // 单层解码 '&amp;amp;lt;标注&gt;' → '&amp;lt;标注>'（原来被两级解码成 '<标注>'）
    expect(links[0]?.text).toBe('&amp;lt;标注>')
  })

  it('对照：真实实体 &lt; 解码结果正确', () => {
    expect(stripTags('&lt;b&gt;')).toBe('<b>')
    expect(extractTitle('<title>&lt;b&gt;</title>')).toBe('<b>')
  })
})

describe('extractLinks', () => {
  const base = 'https://example.edu/list'

  it('解析相对链接并解码锚文本', () => {
    expect(extractLinks('<a href="/notice/1">竞赛&nbsp;报名</a>', base))
      .toEqual([{ url: 'https://example.edu/notice/1', text: '竞赛 报名' }])
  })

  it('跳过空锚文本与非 http 协议', () => {
    const html = '<a href="/a"></a><a href="javascript:void(0)">点我</a><a href="/ok">有效</a>'
    expect(extractLinks(html, base)).toEqual([{ url: 'https://example.edu/ok', text: '有效' }])
  })

  it('跳过非法 href', () => {
    expect(extractLinks('<a href="http://">坏链</a>', base)).toEqual([])
  })

  it('支持单引号属性', () => {
    expect(extractLinks("<a href='/n'>通知</a>", base)).toEqual([{ url: 'https://example.edu/n', text: '通知' }])
  })

  it('绝对 http(s) 链接原样保留', () => {
    expect(extractLinks('<a href="http://other.edu/a">外链</a>', base))
      .toEqual([{ url: 'http://other.edu/a', text: '外链' }])
  })
})

describe('result', () => {
  it('ok/fail 符合 AGENT.md §4.7 统一返回结构', () => {
    expect(ok({ a: 1 })).toEqual({ code: 0, message: 'ok', data: { a: 1 } })
    expect(fail(404, '未找到')).toEqual({ code: 404, message: '未找到', data: null })
  })
})
