/** A1 统一信息流：时间倒序、标注来源、截止时间高亮 */
import { View, Text } from '@tarojs/components'
import { usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import InfoCard from '../../components/info-card'
import { useInfoList } from '../../hooks/use-info-list'
import './index.scss'

export default function Feed() {
  const { items, loading, loaded, error, refresh, loadMore } = useInfoList()

  usePullDownRefresh(() => {
    refresh()
  })
  useReachBottom(() => {
    loadMore()
  })

  return (
    <View className='feed'>
      {error && (
        <View className='feed__state'>
          <Text className='feed__state-text'>{error}</Text>
          <View className='feed__retry' onClick={refresh}>重试</View>
        </View>
      )}
      {!error && loaded && items.length === 0 && (
        <View className='feed__state'>
          <Text className='feed__state-text'>暂无信息，稍后再来看看</Text>
        </View>
      )}
      {!error && items.map((info) => (
        <InfoCard key={info.id} info={info} />
      ))}
      {!error && loading && <View className='feed__state'><Text className='feed__state-text'>加载中…</Text></View>}
    </View>
  )
}
