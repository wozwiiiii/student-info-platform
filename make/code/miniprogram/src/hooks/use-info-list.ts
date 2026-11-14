/** 信息流分页加载（A1/A2 共用） */
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import type { InfoCategory, Information } from '@shared/types'
import { listInfo } from '../services/info'

const PAGE_SIZE = 20

export function useInfoList(category?: InfoCategory) {
  const [items, setItems] = useState<Information[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState('')
  const pageRef = useRef(1)
  /** 在途请求数：分页翻页去重用（任一请求在途时忽略 loadMore） */
  const pendingRef = useRef(0)
  /** 请求序号：每次发起自增，响应回来序号不是最新即丢弃，防旧响应覆盖新分类结果 */
  const requestSeqRef = useRef(0)

  const load = useCallback(async (page: number, replace: boolean) => {
    // 不再「在途即丢弃」：刷新总能发起新请求，旧请求结果靠序号过期作废
    const seq = ++requestSeqRef.current
    pendingRef.current += 1
    setLoading(true)
    try {
      const res = await listInfo({ category, page, pageSize: PAGE_SIZE })
      // 过期响应（期间又发起了更新的请求）直接丢弃，不写 state
      if (seq !== requestSeqRef.current) return
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]))
      setHasMore(page * PAGE_SIZE < res.total)
      pageRef.current = page
      setError('')
    } catch (e) {
      if (seq !== requestSeqRef.current) return
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      pendingRef.current -= 1
      if (seq === requestSeqRef.current) {
        setLoading(false)
        setLoaded(true)
        Taro.stopPullDownRefresh()
      }
    }
  }, [category])

  const refresh = useCallback(() => load(1, true), [load])
  const loadMore = useCallback(() => {
    // 同一次列表内翻页防重复：有请求在途时忽略
    if (hasMore && pendingRef.current === 0) load(pageRef.current + 1, false)
  }, [hasMore, load])

  // 首次进入 / 切换分类时刷新
  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, loaded, hasMore, error, refresh, loadMore }
}
