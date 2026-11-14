# 阶段四 · admin 管理后台 审查与测试文档

> 阶段目标：对 `make/code/admin/`（Vue 3 + Vite + TypeScript + Element Plus）做代码审查。
> **本阶段测试用例数为 0**，理由同阶段三（AGENT.md §4.8「UI 不强制 E2E」、无浏览器测试基建），执行的是静态审查 + 交叉核验。

---

## 一、审查方法

1. 逐文件读 `admin/src/**` 的 `.ts/.vue` 与 `admin/` 下的 `vite.config.ts`、`tsconfig.json`、`.env.development`、`package.json`；
2. 逐条对照 AGENT.md §4.1–§4.10；
3. 对 6 个重点疑点（A–F）给出「已证实 / 已证伪 / 不确定」+ 行号证据；
4. **本侧独立复核关键结论**（见 §4），未直接采信子代理初稿。

---

## 二、总体结论

admin 后台是四层中**规范落地度最高**的部分：TS `strict: true` 且零 `any`、字段类型全部走 `@shared`、录入页确实过 zod、发布有「勾选人工复核」的强制交互、错误处理不吞错且无假数据兜底、依赖克制（仅 vue / vue-router / element-plus / zod）。

仅 3 项低严重度问题（SN-35 / SN-36 / SN-37），**均不触及核心底线**。

值得注意的是：本阶段发现的问题之所以少，很大程度上是因为**关键防线前移到了 shared 与云函数层**——而阶段一/二恰恰在那里查出了多个高危缺陷。换言之，后台 UI 做得对，不代表链路安全。

---

## 三、逐条基准核对

| 基准 | 结论 | 证据 |
|---|---|---|
| §4.1 TS strict 全线、禁 `any` | ✅ 达标 | [`admin/tsconfig.json:6`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/tsconfig.json#L6) 为 `strict: true`，另开 `noImplicitAny`（行 7）与 `noUncheckedIndexedAccess`（行 8）；全 src 检索 `any` / `as any` / `@ts-ignore` **零命中** |
| §4.2 写操作过 zod | ✅ 达标 | [`InfoCreate.vue:96`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/InfoCreate.vue#L96) `informationCreateSchema.safeParse(buildInput())`，失败展示逐字段错误（行 97-101） |
| §4.3 AI 不直发、deadline 人工复核 | ✅ 达标（UI 层） | [`ReviewQueue.vue:123-126`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L123-L126) 未勾选则拦截并提示；[:242](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L242) 确认按钮 `:disabled`；[:129-133](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L129-L133) 仅勾选后才传 `deadlineVerifiedByHuman: true` |
| §4.4 可溯源硬校验 | ✅ 达标 | 录入必经 zod 的 `.refine()` 强制 sourceUrl/sourceChannel 至少一项；页面有对应提示文案 |
| §4.5 幂等去重 | ✅ 达标 | 录入命中 `contentHash` 时展示「命中去重，返回既有条目 id=...，未重复入库」（`InfoCreate.vue:107-108`），符合「返回既有条目而非报错」 |
| §4.6 密钥安全 | ✅ 当前达标 | `api.ts` 全文无 token/密钥；`.env.development` 仅占位网关地址 `https://your-env.service.tcloudbase.com` |
| §4.7 错误处理 | ✅ 达标（甚至偏严） | [`api.ts`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/services/api.ts) 分层捕获网络失败 / 读取失败 / 非 2xx / 非 JSON / **响应不符 `{code,message,data}` 契约**（行 71-96），全部返回真实 message；未配置 `VITE_API_BASE` 时显式报错，**不做假数据兜底** |
| §4.8 测试底线 | ✅ 符合 | UI 不强制 E2E |
| §4.9 依赖克制 | ✅ 达标 | 仅 vue / vue-router / element-plus / zod（+ vite 构建链） |
| §3.3 时间规则 | ✅ 达标 | `InfoCreate.vue:46-48` `attachOffset` 补 `+08:00`、`:56` 写 `tz` |

---

## 四、重点疑点核查（A–F）

| # | 疑点 | 结论 | 证据 |
|---|---|---|---|
| A | 审核发布时 `deadlineVerifiedByHuman` 是否由审核员显式确认 | **已证实（UI 层正确）** | `openPublish` 重置 `deadlineChecked=false`（[:101](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L101)）；`confirmPublish` 未勾选即拦截（[:123-126](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L123-L126)）；确认按钮 `:disabled`（[:242](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L242)）；仅勾选后显式传 `true`（[:129-133](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L129-L133)）；无 deadline 条目不传该字段 |
| B | 录入页是否过 zod；contentHash 前端算还是云端算 | **已证实** | `InfoCreate.vue:96` 过 zod；**contentHash 前端不计算**，由云函数 `api-admin/src/index.ts:44` 调 shared 的 `computeContentHash`，单一实现、与阶段一测试一致 |
| C | `api.ts` 是否硬编码密钥；非 0 code 是否识别；是否吞错 | **已证实合规** | 全文无密钥；`res.code === 0` 分支明确，失败展示 `res.message`；所有失败路径返回带 message 的 `ApiResult` |
| D | 是否存在 `any` / `as any` / 未处理 Promise | **已证实合规** | 零命中；Promise 均以 `void` 显式处理（`ReviewQueue.vue:61,137,151`） |
| E | tsconfig 是否 strict；vite.config 是否可疑 | **已证实合规** | `tsconfig.json:6-8` strict + noImplicitAny + noUncheckedIndexedAccess；`vite.config.ts:10,16` 仅 `@shared` alias 与 `fs.allow` 父目录 |
| F | 是否有无来源信息的录入入口 | **已证伪** | 录入必经 `informationCreateSchema` 的 refine（`shared/schemas/information.ts:35-38`）强制来源至少一项，无绕过入口 |

---

## 五、问题清单

| 编号 | 严重度 | 位置 | 问题 | 依据 |
|---|---|---|---|---|
| SN-35 | 低 | [`services/api.ts:97`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/services/api.ts#L97) | `(parsed.data ?? null) as T \| null` 对未知 JSON 直接断言为目标类型，`data` 内部结构未做运行时校验。外层 envelope 已校验（`isApiEnvelope`），故仅内层 payload 有风险：云函数返回结构不符时前端运行时出错 | §4.2 技术风险（未违反明文底线） |
| SN-36 | 低 | [`admin/.gitignore`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/.gitignore) | 仅忽略 `node_modules`、`dist`，未忽略 `.env*`。当前 `.env.development` 仅占位地址，**无真实密钥**，属防护缺口而非现行泄漏 | §4.6 |
| SN-37 | 低 | [`views/ReviewQueue.vue:204`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/admin/src/views/ReviewQueue.vue#L204) | 发布按钮对所有状态行可用（含已驳回/已发布行），无前端状态过滤。服务端 `api-admin` 的 `canTransition` 有防护，**非安全问题**，仅为交互瑕疵 | §4.10 可用性 |
| — | 低 | `InfoCreate.vue:104-118`、`ReviewQueue.vue:106-117` | `try/finally` 无 `catch`，理论上未预期异常会成为未处理 rejection；但 `api.ts:64-95` 已捕获全部可预期异常，实际风险很低 | §4.7 |

---

## 六、复核记录（不盲信子代理）

| 结论 | 复核方式 | 复核结果 |
|---|---|---|
| 疑点 A（UI 强制人工复核） | 直接读 `ReviewQueue.vue:95-155` 与 `:228-252` | ✅ 确认：勾选拦截 + 按钮 `:disabled` + 仅勾选后传 `true` 三重防线均在 |
| SN-35（`as T` 断言） | 直接读 `api.ts` 全文（118 行） | ✅ 确认行 97；同时**修正了子代理的评价倾向**——`api.ts` 的错误处理实际相当严谨（5 层分层捕获 + envelope 契约校验 + 拒绝假数据兜底），SN-35 应定位为「内层 payload 未校验」这一处小缺口，而非笼统的「错误处理弱」 |
| 疑点 B（contentHash 归属） | 读 `InfoCreate.vue:75-120` | ✅ 确认前端只 `safeParse` 后提交 `parsed.data`，不计算哈希；并补充：`buildInput()` 不含 `deadlineVerifiedByHuman`，schema 默认填 `false`，故**录入路径不会自报复核** |
| 疑点 F（无来源入口） | 读 `InfoCreate.vue:126-129` 提示文案 + shared refine | ✅ 确认无绕过入口 |

> 一处修正：子代理对 `api.ts` 的整体评价偏保守。本侧逐行复核后确认其错误处理属上乘，仅内层 payload 断言是缺口。已按复核结果下调该问题的表述权重。

---

## 七、本阶段结论与建议

1. admin 层**无需优先投入**。三项问题均为低严重度，且 SN-36 只需在 `.gitignore` 加一行 `.env*` 即可关闭。
2. SN-35 若要改进，做法是给关键响应（`InfoListData` / `ReviewData` / `CreateInfoData`）补 zod schema 校验——但这属于增强，非必需。
3. **本阶段最重要的发现是一个交叉结论**：后台 UI 正确实现了「人工复核」交互（疑点 A 已证实），但阶段二 SN-01 表明云函数 `info.create` 仍接受自报的 `deadlineVerifiedByHuman: true`。也就是说——

   > **「人工复核」这条底线目前只靠 admin 前端这一层保证，API 契约层并不设防。**

   任何直接调用 `api-admin` 的入口（脚本、第三方、未来的其他客户端）都能绕过它。修复必须落在服务端（`shared/schemas/information.ts` 不接受该字段 + `api-admin.createInfo` 强制置 false），而不是继续加固前端。
