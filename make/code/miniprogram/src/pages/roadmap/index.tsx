/**
 * A4 简版成长路线图：按学年+学期分组的关键节点，节点内嵌关联的实时信息。
 * R8：每个节点展示最后整理时间（数据可能过期，保持透明）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { usePullDownRefresh } from '@tarojs/taro'
import { groupNodesByYearSemester } from '@shared/domain'
import type { RoadmapNodeWithInfos } from '@shared/types'
import { listRoadmap } from '../../services/roadmap'
import InfoCard from '../../components/info-card'
import { CATEGORY_LABELS, ROADMAP_SEMESTER_LABELS, ROADMAP_YEAR_LABELS } from '../../utils/format'
import './index.scss'

export default function Roadmap() {
  const [nodes, setNodes] = useState<RoadmapNodeWithInfos[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listRoadmap()
      setNodes(res.items)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
      setLoaded(true)
      Taro.stopPullDownRefresh()
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  usePullDownRefresh(() => {
    load()
  })

  // 展示分组顺序由 shared 领域函数统一提供（与云端排序一致）
  const groups = useMemo(() => groupNodesByYearSemester(nodes), [nodes])

  return (
    <View className='roadmap'>
      <View className='roadmap__header'>
        <Text className='roadmap__title'>成长路线图</Text>
        <Text className='roadmap__subtitle'>大学四年关键节点与实时信息（人工整理，注意查看整理时间）</Text>
      </View>

      {error && (
        <View className='roadmap__state'>
          <Text className='roadmap__state-text'>{error}</Text>
          <View className='roadmap__retry' onClick={load}>重试</View>
        </View>
      )}
      {!error && loaded && groups.length === 0 && (
        <View className='roadmap__state'>
          <Text className='roadmap__state-text'>路线图整理中，敬请期待</Text>
        </View>
      )}

      {!error && groups.map((group) => (
        <View className='roadmap__group' key={`${group.year}-${group.semester}`}>
          <View className='roadmap__group-head'>
            <Text className='roadmap__group-title'>
              {ROADMAP_YEAR_LABELS[group.year]} · {ROADMAP_SEMESTER_LABELS[group.semester]}
            </Text>
          </View>
          {group.nodes.map((node) => (
            <View className='roadmap__node' key={node.id}>
              <View className='roadmap__node-head'>
                <Text className='roadmap__node-title'>{node.title}</Text>
                {node.typicalWindow && <Text className='roadmap__node-window'>{node.typicalWindow}</Text>}
              </View>
              {node.description && <View className='roadmap__node-desc'>{node.description}</View>}
              {node.relatedCategory && (
                <View className='roadmap__node-category'>关注方向：{CATEGORY_LABELS[node.relatedCategory]}</View>
              )}

              <View className='roadmap__node-infos'>
                <Text className='roadmap__node-infos-label'>实时信息</Text>
                {node.relatedInfos.length === 0 ? (
                  <View className='roadmap__node-infos-empty'>暂无关联的进行中信息</View>
                ) : (
                  node.relatedInfos.map((info) => <InfoCard key={info.id} info={info} />)
                )}
              </View>

              <View className='roadmap__node-maintained'>整理于 {node.lastMaintainedAt}</View>
            </View>
          ))}
        </View>
      ))}
      {!error && loading && (
        <View className='roadmap__state'><Text className='roadmap__state-text'>加载中…</Text></View>
      )}
    </View>
  )
}
