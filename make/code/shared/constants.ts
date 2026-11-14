/**
 * 公共常量（三方共用）
 */

/**
 * 截止提醒订阅消息模板 ID（A3）
 * 【客观事实】模板 ID 由微信公众平台「订阅消息」选用/申请后取得，无法在代码中凭空生成。
 * 部署前必须替换为真实值；job-remind 可用环境变量 REMIND_TEMPLATE_ID 覆盖。
 * 模板字段约定（选用模板时需与之匹配）：thing1=信息标题，time2=截止时间。
 */
export const REMIND_TEMPLATE_ID = 'REPLACE_WITH_MP_REMIND_TEMPLATE_ID'

/** 提醒推送定时任务的判定窗口（毫秒），覆盖每小时触发的间隔并留余量 */
export const REMIND_WINDOW_MS = 2 * 60 * 60 * 1000
