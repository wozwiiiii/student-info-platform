# 阶段三 · miniprogram 小程序端 审查与测试文档

> 阶段目标：对 `make/code/miniprogram/`（Taro 4 + React + TypeScript）做代码审查。
> **本阶段测试用例数为 0**，原因见 §1，这是明确取舍而非遗漏。

---

## 一、本阶段为何没有自动化测试（如实说明）

| 依据 | 内容 |
|---|---|
| AGENT.md §4.8 测试底线 | 「`shared/domain` 纯函数**必须有** Vitest 单测；云函数**至少冒烟测试**；**UI 不强制 E2E**（单兵产能现实约束）」 |
| 现实约束 | 项目测试基建只有 `vitest.config.ts`（`environment: node`），**无小程序运行时 / DOM 环境**；Taro 页面依赖 `@tarojs/taro` 与微信容器 API，脱离容器无法直接跑 |
| 领域逻辑位置 | 按 AGENT.md §2.3「视图层保持薄——领域逻辑收敛在 `shared/`」，可单测的业务逻辑本就应在 shared 层，且已在**阶段一**全部覆盖（74 用例） |

**结论**：本阶段执行的是**静态代码审查 + 交叉核验**，不产出自动化用例。若后续要补，建议优先给 `src/utils/format.ts`（纯函数，可直接进 vitest）加用例，而不是给页面写 E2E。

---

## 二、审查方法

1. 逐文件读 `src/**` 的 `.ts/.tsx/.scss` 与 `config/**`；
2. 逐条对照 AGENT.md §4.1–§4.10 与 §2.3 Taro 跨端红线；
3. 对 6 个重点疑点（A–F）给出「已证实 / 已证伪 / 不确定」+ 行号证据；
4. 由子代理出具初稿后，**本侧独立复核关键结论**（见 §4「复核记录」）。

---

## 三、审查结论

### 3.1 总体评价

小程序端整体质量良好：跨端字段全部来自 `@shared`、云函数调用统一封装且正确处理非 0 code、投稿流程有输入校验与错误提示、无 `any` / 无 DOM 依赖 / 无明显内存泄漏、列表分页与防重复请求已实现。主要缺陷是 **TS 配置未达 strict 要求**（SN-31）与**信息流 hook 的请求竞态**（SN-32）。

### 3.2 逐条基准核对

| 基准 | 结论 | 证据 |
|---|---|---|
| §4.1 TS strict 全线、禁 `any` | **部分不达标** | 代码层面无 `any`（全目录检索零命中），但 [`miniprogram/tsconfig.json:9`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/tsconfig.json#L9) 为 `"noImplicitAny": false`，且只有 `strictNullChecks`（行 14）而无 `"strict": true` → 隐式 any 不被拦截 |
| §4.2 字段来自 `shared/`、写操作过 zod | ✅ 达标 | 类型均 `import type ... from '@shared/types'`；投稿 payload 仅 `{url, sourceChannel, note}`，zod 校验在服务端（`api-submission` + `shared/schemas`） |
| §4.3 AI 不直发、deadline 人工复核 | ✅ 不适用/达标 | 小程序端无发布入口；全 src 无 `deadlineVerifiedByHuman` 引用（见 §4 疑点 A） |
| §4.4 可溯源硬校验 | ✅ 达标 | 无绕过录入入口 |
| §4.5 幂等去重 | ✅ 不适用 | contentHash 由云函数计算，前端不参与 |
| §4.6 密钥安全 | ✅ 当前达标 | `.env.development/production/test` 仅含注释占位（`# TARO_APP_ID=...`），无真实密钥；但 `.gitignore` 只忽略 `*.local`，未忽略 `.env*`（SN-34） |
| §4.7 错误处理 | ✅ 达标 | [`cloud.ts:40-42`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/services/cloud.ts#L40-L42) 对非 0 code 抛 Error，调用方均有 catch 展示 |
| §4.8 测试底线 | ✅ 符合 | UI 不强制 E2E |
| §3.3 时间规则 | ⚠️ 部分 | 带偏移 ISO 正确；无偏移裸串依赖设备时区（SN-33） |
| §2.3 Taro 跨端红线 | ✅ 达标 | 无浏览器 DOM / ReactDOM / 内联 `<svg>`；`Image` 未使用；平台差异走 `process.env.TARO_ENV` |
| §4.10 性能与成本 | ⚠️ 一处竞态 | 分页已实现，但 SN-32 会导致丢请求 |

### 3.3 问题清单

| 编号 | 严重度 | 位置 | 问题 | 依据 |
|---|---|---|---|---|
| SN-31 | 中 | [`miniprogram/tsconfig.json:9,14`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/tsconfig.json#L9) | `noImplicitAny: false`，且未开 `strict: true`（仅 `strictNullChecks`），与 §4.1「TS strict 全线」不符。当前代码未出现显式 `any`，但编译器不再拦截隐式 any | §4.1 |
| SN-32 | 中 | [`src/hooks/use-info-list.ts:19-20,44-46`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/hooks/use-info-list.ts#L19-L20) | `load()` 开头 `if (loadingRef.current) return` 直接丢弃请求。切换分类瞬间若旧请求在途，新分类的 `refresh()` 被吞且**不重试**，页面停留在旧分类数据；另无过期响应防护（旧响应可能覆盖新分类结果） | §4.10 可靠性 |
| SN-33 | 低 | [`src/utils/format.ts:29`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/utils/format.ts#L29) | `new Date(iso)` 对**无时区偏移**的裸时间串按设备本地时区解析，设备非 +8 时换算偏差。带 `Z`/`+08:00` 的 ISO 正确 | §3.3 时间规则 |
| SN-34 | 低 | [`miniprogram/.gitignore`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/.gitignore) | 仅忽略 `*.local`，未忽略 `.env*`。当前三个 `.env.*` 仅注释占位、无真实密钥，故为防护缺口而非现行泄漏 | §4.6 |
| — | 低 | [`src/pages/calendar/index.tsx:85`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/pages/calendar/index.tsx#L85) | `as Taro.requestSubscribeMessage.Option` 单层断言绕过类型必填校验（有注释说明 Taro 4.1.9 类型与 weapp 运行时契约差异） | §4.1 |
| — | 低 | [`src/app.ts:14`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/app.ts#L14)、[`calendar/index.tsx:45-47`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/pages/calendar/index.tsx#L45-L47) | 两处有意静默吞错（均有注释，属旁路逻辑，主链路错误已展示） | §4.7 |

### 3.4 重点疑点核查（A–F）

| # | 疑点 | 结论 | 证据 |
|---|---|---|---|
| A | 小程序是否可自报 `deadlineVerifiedByHuman` 越权 | **已证伪** | [`src/services/submission.ts:10-16`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/services/submission.ts#L10-L16) payload 仅 `{url, sourceChannel, note}`；全 src 无该字段引用；云端 `api-submission/src/index.ts:110` 强制置 `false`。**但**服务端 `api-admin.info.create` 仍接受该字段（阶段二 SN-01），客户端虽未越权，API 契约层仍有缺口 |
| B | 时间格式化是否正确处理 Asia/Shanghai | **基本正确** | 带偏移 ISO 换算正确，`+08:00` 串直接切片正确；仅裸串场景依赖设备时区（SN-33） |
| C | 投稿流程是否有输入校验与失败提示 | **已证实有** | [`submit/index.tsx:21-28`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/src/pages/submit/index.tsx#L21-L28) URL 正则 + 来源必填，失败 `setMessage`；catch 展示错误（行 39-42）；zod 校验在服务端 |
| D | 错误处理是否静默吞错 | **已证实正确** | `cloud.ts:40-42` 非 0 code 抛 Error；调用方均展示；仅两处有意旁路（见 §3.3 末两行） |
| E | `config/index.ts` 的 shared include 路径（AGENT.md E-004 返工点） | **已证伪（路径正确）** | [`config/index.ts:8`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/miniprogram/config/index.ts#L8) `resolve(__dirname,'..','..','shared')` 实测解析为 `make/code/shared`（存在），且置于 `mini.compile` / `h5.compile` 平台级（行 42-44、65-67），与 AGENT.md 记录的最终方案一致 |
| F | 是否存在 `any` / 强转 / 未处理 Promise / 内存泄漏 | **基本合规** | 无 `any`、无 `as unknown as`（仅 `cloud.ts:39,43`、`calendar:85` 三处单层 `as`）；Promise 均有 catch/finally；无定时器/订阅/事件监听，无泄漏迹象 |

---

## 四、复核记录（不盲信子代理）

本阶段初稿由子代理出具，本侧对以下**关键结论**做了独立复核：

| 结论 | 复核方式 | 复核结果 |
|---|---|---|
| SN-31（tsconfig 未开 strict） | 直接读 `miniprogram/tsconfig.json` | ✅ 确认：第 9 行 `noImplicitAny: false`，全文件无 `"strict": true`，仅第 14 行 `strictNullChecks: true` |
| SN-32（hook 竞态） | 直接读 `src/hooks/use-info-list.ts` 全文 | ✅ 确认：第 19 行 `if (loadingRef.current) return`，第 44-46 行 `useEffect` 依赖 `refresh` 触发；无过期响应防护 |
| 疑点 A（无越权） | 读 `src/services/submission.ts` | ✅ 确认 payload 三字段；并补充说明「API 契约层仍有缺口」这一子代理未点明的层次 |
| 疑点 E（E-004 路径已修） | 读 `config/index.ts` | ✅ 确认路径正确 |

> 复核中未发现子代理的错误结论；但补充了「客户端未越权 ≠ API 契约安全」这一区分，避免结论被误读。

---

## 五、本阶段结论与建议

1. **SN-31 建议优先修**：把 `miniprogram/tsconfig.json` 改为 `"strict": true`（并删去 `noImplicitAny: false`）。改动成本极低（当前代码已无显式 any），收益是让编译器长期守住 §4.1 底线。
2. **SN-32 是唯一影响用户体验的缺陷**：建议在 `load()` 内用请求序号（request id）丢弃过期响应，并把「在途则跳过」改为「在途则取消旧请求 / 或排队补跑」。
3. 时间格式化建议统一收敛到 `shared/domain`（与阶段二 SN-28 一并处理），避免云函数、小程序、后台三处各写一遍时区换算。
