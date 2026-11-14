/** 信息卡片（A1/A2 共用）：截止时间是第一公民——deadline 高亮置前 */
import { View, Text } from '@tarojs/components'
import type { Information } from '@shared/types'
import { CATEGORY_LABELS, SUBTYPE_LABELS, SOURCE_TYPE_LABELS, formatDeadline, formatIsoToShanghai } from '../../utils/format'
import './index.scss'

export default function InfoCard({ info }: { info: Information }) {
  const deadline = formatDeadline(info.deadline)
  return (
    <View className='info-card'>
      <View className='info-card__tags'>
        <Text className='info-card__tag info-card__tag--category'>{CATEGORY_LABELS[info.category]}</Text>
        {info.subType && info.subType !== 'other' && (
          <Text className='info-card__tag'>{SUBTYPE_LABELS[info.subType]}</Text>
        )}
      </View>
      <View className='info-card__title'>{info.title}</View>
      {info.summary && <View className='info-card__summary'>{info.summary}</View>}
      {deadline && (
        <View className='info-card__deadline'>
          <Text className='info-card__deadline-label'>截止</Text>
          <Text className='info-card__deadline-value'>{deadline}</Text>
        </View>
      )}
      <View className='info-card__source'>
        <Text>来源 {info.sourceChannel || SOURCE_TYPE_LABELS[info.sourceType]}</Text>
        <Text className='info-card__time'>{formatIsoToShanghai(info.publishedAt || info.createdAt)}</Text>
      </View>
    </View>
  )
}
