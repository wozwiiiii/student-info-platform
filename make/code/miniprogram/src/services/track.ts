/**
 * 埋点服务（M5，spec 第 6 节验证指标）
 * fire-and-forget：任何埋点失败静默吞掉，绝不阻塞/影响主链路
 */
import { callApi } from './cloud'

/** 每日活跃埋点（周活口径；云端按 openId + 当天幂等去重） */
export function trackActivity(): void {
  callApi('api-user', 'track.activity').catch(() => {})
}

/** 订阅消息回流打开埋点（打开率口径） */
export function trackOpenRemind(infoId?: string): void {
  callApi('api-user', 'track.event', {
    type: 'open_remind',
    ...(infoId ? { infoId } : {})
  }).catch(() => {})
}
