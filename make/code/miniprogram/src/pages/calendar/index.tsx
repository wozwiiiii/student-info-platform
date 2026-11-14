/** A3 Deadline 日历：按截止日期分组的临近截止清单 + 订阅消息提醒授权入口 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { usePullDownRefresh } from '@tarojs/taro'
import { REMIND_TEMPLATE_ID } from '@shared/constants'
import type { Information } from '@shared/types'
import { listDeadlines } from '../../services/info'
import { ensureLogin, getSubscribeStatus, recordSubscribe } from '../../services/user'
import { trackOpenRemind } from '../../services/track'
import { isCloudAvailable } from '../../services/cloud'
import { CATEGORY_LABELS, formatCountdown, formatDeadline, formatIsoToShanghai } from '../../utils/format'
import './index.scss'

interface DeadlineGroup {
  date: string
  items: Information[]
}

/** requestSubscribeMessage 返回 Success | Fail 联合类型，Fail 分支没有模板 id 动态键，先收窄再取授权结果 */
function isSubscribeSuccess(
  res: Taro.requestSubscribeMessage.SuccessCallbackResult | Taro.requestSubscribeMessage.FailCallbackResult
): res is Taro.requestSubscribeMessage.SuccessCallbackResult {
  return !('errCode' in res)
}

export default function Calendar() {
  const [items, setItems] = useState<Information[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listDeadlines(30)
      setItems(res.items)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
      setLoaded(true)
      Taro.stopPullDownRefresh()
    }
  }, [])

  const loadStatus = useCallback(async () => {
    if (!isCloudAvailable()) return
    try {
      const status = await getSubscribeStatus()
      setQuota(status.totalQuota)
    } catch {
      // 状态查询失败不阻塞日历主链路
    }
  }, [])

  useEffect(() => {
    load()
    loadStatus()
  }, [load, loadStatus])

  // M5 打开率埋点：订阅消息跳转携带 from=remind（job-remind 的 page 参数），失败静默
  const router = Taro.useRouter()
  useEffect(() => {
    if (router.params.from === 'remind') {
      trackOpenRemind(router.params.infoId)
    }
  }, [router.params])

  usePullDownRefresh(() => {
    load()
    loadStatus()
  })

  const groups: DeadlineGroup[] = useMemo(() => {
    const map = new Map<string, Information[]>()
    for (const info of items) {
      const key = formatDeadline(info.deadline).slice(0, 10)
      const arr = map.get(key) ?? []
      arr.push(info)
      map.set(key, arr)
    }
    return Array.from(map.entries()).map(([date, list]) => ({ date, items: list }))
  }, [items])

  /** 订阅授权（A3/R11）：一次性授权成功后记录授权余量 */
  const handleSubscribe = async () => {
    if (process.env.TARO_ENV !== 'weapp') {
      Taro.showToast({ title: '请在微信小程序中开启提醒', icon: 'none' })
      return
    }
    if (REMIND_TEMPLATE_ID.startsWith('REPLACE_')) {
      Taro.showToast({ title: '提醒模板尚未配置，请联系管理员', icon: 'none' })
      return
    }
    try {
      await ensureLogin()
      // 【客观事实】Taro 4.1.9 类型把 tmplIds/entityIds 均标为必填（AtLeastOne 未生效），
      // weapp 运行时契约只需 tmplIds，此处按运行时契约断言
      const res = await Taro.requestSubscribeMessage({ tmplIds: [REMIND_TEMPLATE_ID] } as Taro.requestSubscribeMessage.Option)
      const status = isSubscribeSuccess(res) ? String(res[REMIND_TEMPLATE_ID] ?? '') : ''
      if (status !== 'accept') {
        Taro.showToast({ title: '未授权，无法推送提醒', icon: 'none' })
        return
      }
      await recordSubscribe({ templateId: REMIND_TEMPLATE_ID, quota: 1 })
      Taro.showToast({ title: '已开启截止提醒', icon: 'success' })
      loadStatus()
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '开启失败', icon: 'none' })
    }
  }

  return (
    <View className='calendar'>
      <View className='calendar__header'>
        <View className='calendar__header-text'>
          <Text className='calendar__title'>截止日历</Text>
          <Text className='calendar__subtitle'>未来 30 天内截止的信息</Text>
        </View>
        <View className='calendar__subscribe' onClick={handleSubscribe}>开启截止提醒</View>
      </View>
      {quota !== null && (
        <View className='calendar__quota'>
          {quota > 0 ? `可推送提醒次数：${quota}（每次授权可用 1 次）` : '暂无可用提醒次数，点击右上角授权'}
        </View>
      )}

      {error && (
        <View className='calendar__state'>
          <Text className='calendar__state-text'>{error}</Text>
          <View className='calendar__retry' onClick={load}>重试</View>
        </View>
      )}
      {!error && loaded && groups.length === 0 && (
        <View className='calendar__state'>
          <Text className='calendar__state-text'>未来 30 天暂无截止事项</Text>
        </View>
      )}

      {!error && groups.map((group) => (
        <View className='calendar__group' key={group.date}>
          <View className='calendar__group-head'>
            <Text className='calendar__group-date'>{group.date}</Text>
            <Text className='calendar__group-count'>{formatCountdown(group.items[0].deadline)}</Text>
          </View>
          {group.items.map((info) => (
            <View className='calendar__item' key={info.id}>
              <View className='calendar__item-tags'>
                <Text className='calendar__item-tag'>{CATEGORY_LABELS[info.category]}</Text>
              </View>
              <View className='calendar__item-title'>{info.title}</View>
              <View className='calendar__item-meta'>
                <Text className='calendar__item-deadline'>截止 {formatDeadline(info.deadline)}</Text>
                <Text className='calendar__item-count'>{formatCountdown(info.deadline)}</Text>
              </View>
              <View className='calendar__item-source'>
                <Text>来源 {info.sourceChannel || '—'}</Text>
                <Text>{formatIsoToShanghai(info.publishedAt || info.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
      {!error && loading && (
        <View className='calendar__state'><Text className='calendar__state-text'>加载中…</Text></View>
      )}
    </View>
  )
}
