/** A2 分类频道：机会成长 > 奖助评优 > 教务通知 > 讲座活动（spec v1.0 优先级） */
import { View, Text } from '@tarojs/components'
import { usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useState } from 'react'
import type { InfoCategory } from '@shared/types'
import InfoCard from '../../components/info-card'
import { useInfoList } from '../../hooks/use-info-list'
import { CATEGORY_LABELS } from '../../utils/format'
import './index.scss'

const CHANNELS: Array<{ key: InfoCategory; desc: string }> = [
  { key: 'opportunity', desc: '竞赛 / 就业实习 / 保研' },
  { key: 'scholarship', desc: '奖学金 / 助学金 / 评优' },
  { key: 'academic', desc: '教务处通知转发' },
  { key: 'lecture', desc: '讲座 / 活动' }
]

export default function Category() {
  const [selected, setSelected] = useState<InfoCategory>('opportunity')
  const { items, loading, loaded, error, refresh, loadMore } = useInfoList(selected)

  usePullDownRefresh(() => {
    refresh()
  })
  useReachBottom(() => {
    loadMore()
  })

  return (
    <View className='category'>
      <View className='category__grid'>
        {CHANNELS.map((ch) => (
          <View
            key={ch.key}
            className={`category__card${selected === ch.key ? ' category__card--active' : ''}`}
            onClick={() => setSelected(ch.key)}
          >
            <Text className='category__card-title'>{CATEGORY_LABELS[ch.key]}</Text>
            <Text className='category__card-desc'>{ch.desc}</Text>
          </View>
        ))}
      </View>

      {error && (
        <View className='category__state'>
          <Text className='category__state-text'>{error}</Text>
          <View className='category__retry' onClick={refresh}>重试</View>
        </View>
      )}
      {!error && loaded && items.length === 0 && (
        <View className='category__state'>
          <Text className='category__state-text'>该分类暂无信息</Text>
        </View>
      )}
      {!error && items.map((info) => (
        <InfoCard key={info.id} info={info} />
      ))}
      {!error && loading && <View className='category__state'><Text className='category__state-text'>加载中…</Text></View>}
    </View>
  )
}
