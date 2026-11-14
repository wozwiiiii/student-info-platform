import { describe, expect, it } from 'vitest'
import { trackEventSchema } from '../metrics'

describe('trackEventSchema', () => {
  it('合法 open_remind 事件通过，infoId 可选', () => {
    expect(trackEventSchema.parse({ type: 'open_remind' })).toEqual({ type: 'open_remind' })
    expect(trackEventSchema.parse({ type: 'open_remind', infoId: 'info_1' }).infoId).toBe('info_1')
  })

  it('未知事件类型被拒绝（防任意写入）', () => {
    expect(trackEventSchema.safeParse({ type: 'page_view' }).success).toBe(false)
    expect(trackEventSchema.safeParse({}).success).toBe(false)
  })
})
