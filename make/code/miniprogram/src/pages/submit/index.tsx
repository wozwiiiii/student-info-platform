/**
 * B5 众包投稿：提交链接 + 来源，AI 预审 + 人工确认后入库
 * 产品原则落地：不做无来源信息 → 来源渠道为必填项
 */
import { View, Text, Input, Textarea } from '@tarojs/components'
import { useState } from 'react'
import { createSubmission } from '../../services/submission'
import './index.scss'

export default function Submit() {
  const [url, setUrl] = useState('')
  const [sourceChannel, setSourceChannel] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async () => {
    if (submitting) return
    const trimmedUrl = url.trim()
    const trimmedSource = sourceChannel.trim()
    if (!/^https?:\/\//.test(trimmedUrl)) {
      setMessage('请填写以 http(s):// 开头的原文链接')
      return
    }
    if (!trimmedSource) {
      setMessage('请填写来源渠道（如公众号名称/网站名称）——不做无来源信息')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      const res = await createSubmission({ url: trimmedUrl, sourceChannel: trimmedSource, note: note.trim() || undefined })
      setMessage(res.duplicate ? '该链接已投稿过，感谢！' : '投稿成功，确认后会进入信息流')
      if (!res.duplicate) {
        setUrl('')
        setSourceChannel('')
        setNote('')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '投稿失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='submit'>
      <View className='submit__intro'>
        <Text className='submit__intro-title'>众包投稿</Text>
        <Text className='submit__intro-desc'>看到有用的竞赛 / 就业实习 / 奖助 / 讲座信息？贴上原文链接，确认后会出现在信息流。</Text>
      </View>

      <View className='submit__form'>
        <View className='submit__field'>
          <Text className='submit__label'>原文链接（必填）</Text>
          <Input
            className='submit__input'
            value={url}
            onInput={(e) => setUrl(e.detail.value)}
            placeholder='https://...'
            placeholderClass='submit__placeholder'
          />
        </View>
        <View className='submit__field'>
          <Text className='submit__label'>来源渠道（必填）</Text>
          <Input
            className='submit__input'
            value={sourceChannel}
            onInput={(e) => setSourceChannel(e.detail.value)}
            placeholder='公众号名称 / 网站名称'
            placeholderClass='submit__placeholder'
          />
        </View>
        <View className='submit__field'>
          <Text className='submit__label'>补充说明（选填）</Text>
          <Textarea
            className='submit__textarea'
            value={note}
            onInput={(e) => setNote(e.detail.value)}
            placeholder='例如：截止时间、面向年级等'
            placeholderClass='submit__placeholder'
            maxlength={200}
          />
        </View>
      </View>

      <View className={`submit__btn${submitting ? ' submit__btn--disabled' : ''}`} onClick={submit}>
        <Text>{submitting ? '提交中…' : '提交投稿'}</Text>
      </View>
      {message && <View className='submit__message'>{message}</View>}
      <View className='submit__note'>
        <Text>投稿将由 AI 预审 + 人工确认后发布；发布前关键信息（尤其截止日期）会经人工复核。</Text>
      </View>
    </View>
  )
}
