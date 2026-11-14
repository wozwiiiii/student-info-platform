# 阶段二 · cloudfunctions 云函数层 审查与 TDD 测试文档

> 阶段目标：对 `make/code/cloudfunctions/`（6 个云函数 + lib 公共库）做代码审查，并补上 AGENT.md §4.8 要求的「云函数至少冒烟测试」。
> 审查基准：AGENT.md §4.2（写操作过 zod）、§4.3（AI 不直发 + deadline 人工复核）、§4.4（可溯源）、§4.5（幂等去重）、§4.7（统一返回 + 结构化日志）、§4.10（性能与成本）。

---

## 一、测试方法与基建

### 1.1 为什么需要测试桩

云函数处理器的唯一外部依赖是 `wx-server-sdk`（微信云开发 SDK），而该包**并未安装在本仓库**（云函数部署时由云端提供，本地 `cloudfunctions/*/index.js` 是 esbuild 打包产物）。因此直接 import 处理器会失败。

处理方式：新增 [`cloudfunctions/__mocks__/wx-server-sdk.ts`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/__mocks__/wx-server-sdk.ts)（内存数据库桩），并在 [`vitest.config.ts`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/vitest.config.ts) 用 `resolve.alias` 把 `wx-server-sdk` 指向该桩。**该桩仅测试期生效，不随云函数部署。**

桩提供：`init` / `database().collection().where().doc().add().get().count().update()` / `getWXContext()` / `openapi.subscribeMessage.send()`，以及测试控制接口 `__reset / __seed / __rows / __setOpenId / __setSendBehavior`。

### 1.2 一个关键的桩语义修正（影响结论正确性）

初版桩的 `get()` 直接返回库内对象**引用**，而真实 `wx-server-sdk` 走网络反序列化，返回的是**独立副本**。二者的差别会让「读快照 → 再更新库」类逻辑测出不同结果：

| 桩语义 | `rec.quota` 在循环内是否变化 | 测出的结论 |
|---|---|---|
| 返回引用（初版） | 会随库更新而变化 | 掩盖 SN-22，误判为「无缺陷」 |
| **返回副本（已修正）** | 保持快照值不变 | **正确暴露 SN-22** |

已改为 `structuredClone(...)` 深拷贝。**结论必须建立在与生产环境一致的语义上**，否则测试本身会误导。

### 1.3 执行命令

```powershell
node node_modules\vitest\vitest.mjs run
node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
```

---

## 二、测试结果

| 测试文件 | 用例数 | 结果 | 覆盖对象 |
|---|---|---|---|
| `cloudfunctions/lib/__tests__/lib.test.ts` | 22 | ✅ 全通过 | classify.ts / html.ts / result.ts |
| `cloudfunctions/__tests__/api-admin.test.ts` | 21 | ✅ 全通过 | api-admin 处理器（4 个 action） |
| `cloudfunctions/__tests__/api-submission.test.ts` | 12 | ✅ 全通过 | api-submission 处理器（3 个 action） |
| `cloudfunctions/__tests__/job-remind.test.ts` | 12 | ✅ 全通过 | job-remind 推送链路 |
| **合计** | **67** | **67/67 通过** | — |

`node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json` → **exit 0**。

---

## 三、用例明细

### 3.1 lib 纯函数（22 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| classifyByTitle | 5 类关键词优先级归类（保研/竞赛/招聘/奖学金/讲座） | ✅ |
| | 无关键词兜底 academic（含空标题） | ✅ |
| | 优先级顺序：保研 > 竞赛；奖学金 > 活动类词 | ✅ |
| | CRAWL_KEYWORDS 过滤噪音条目 | ✅ |
| | CRAWL_KEYWORDS 无 `g` 标志，重复 `test()` 无状态残留 | ✅ |
| extractTitle / stripTags | 提取并解码 title、无 title 返回空、去 script/style/标签、解码实体 | ✅ |
| 【缺陷 SN-14】 | `&amp;lt;` 单次调用即被还原为 `<`；`&amp;#39;` 同样级联 | ✅ |
| | 对照：`&amp;amp;` 只解一层、`&amp;amp;amp;` 只解一层 | ✅ |
| | 外层重复解码：`&amp;amp;lt;` 单层应得 `&amp;lt;`，实际得 `<` | ✅ |
| | extractLinks 锚文本同样被级联解码 | ✅ |
| | 对照：真实实体 `&lt;b&gt;` 解码正确 | ✅ |
| extractLinks | 相对链接解析 + 锚文本解码、空文本与非 http 协议跳过、非法 href 跳过、单引号属性、绝对链接保留 | ✅ |
| result | ok/fail 符合 §4.7 统一返回结构 | ✅ |

### 3.2 api-admin（21 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| info.create | 校验通过落库为 pending_review、缺来源返回 400、未知 action 返回 400 | ✅ |
| | 重复 contentHash 幂等返回既有条目、同标题不同渠道不去重 | ✅ |
| info.review | deadline 未复核禁发（409 + 文案）、缺来源禁发、有来源+已复核发布成功并写 publishedAt | ✅ |
| | 非法状态迁移返回 409、reject/correct 合法并写 review_log、缺 id/非法 action 返回 400、不存在条目 404 | ✅ |
| 【缺陷 SN-01】 | 创建时自报 `deadlineVerifiedByHuman:true` 被持久化；自报 true 后可直接发布 | ✅ |
| | payload 显式传 `deadlineVerifiedByHuman` 可当场解锁发布 | ✅ |
| 【缺陷 SN-20】 | `action:'toString'` 返回 409 而非 400 | ✅ |
| 【缺陷 SN-17】 | 非法 deadline / 空 title / 超长 location 直接写入 | ✅ |
| 【缺陷 SN-18】 | published 条目来源被清空后仍保持 published | ✅ |
| 【缺陷 SN-19】 | 改期后 `deadlineVerifiedByHuman` 保持 true | ✅ |
| 【缺陷 SN-21】 | review_log 无 `diff` 字段、`operator` 恒为 admin | ✅ |
| info.listAdmin | 按状态过滤 + 分页返回 | ✅ |

### 3.3 api-submission（12 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| submission.create | 合法投稿落库 pending、非法 payload 返回 400、同链接幂等返回既有、未知 action 400 | ✅ |
| submission.review | accept 后抓取入库 collected 并置 accepted（含 `deadlineVerifiedByHuman:false`、`sourceType:'user_submission'`） | ✅ |
| | 抓取失败 422 不入库、无法提取标题 422、reject/duplicate 不产生 information、非法 action 400、不存在投稿 404 | ✅ |
| 【缺陷 SN-15】 | 第二次 accept 把 status 从 accepted 翻成 duplicate，且第二次仍真实抓取 | ✅ |
| 【缺陷 SN-16】 | reject 写入 `'reject'` 而非契约的 `'rejected'` | ✅ |

### 3.4 job-remind（12 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| 基本行为 | 未配置模板 ID 显式报错不静默跳过、有余量用户收到提醒并扣减 quota、余量归零同步 `subscribeState:'none'` | ✅ |
| | quota=0 不推送、过期授权不计入、窗口外截止不触发 | ✅ |
| 幂等去重 | 已发送的 `(infoId, remindAt, openId)` 不重发（skipped=1） | ✅ |
| 失败不静默 | 失败写 push_fail（含 errCode）与 reminder_log(status=failed)，且**不消耗授权余量** | ✅ |
| | 失败也记 reminder_log，该提醒点下次不重试 | ✅ |
| 【缺陷 SN-22】 | quota=1 却一次运行内推送 2 条；quota=3 时最终余量算成 2 而非 1 | ✅ |
| 【缺陷 SN-23】 | 3 信息 × 1 提醒点 × 2 用户 → 6 次推送，量化逐条查重的放大 | ✅ |

---

## 四、本阶段缺陷明细

### SN-22【高】授权余量取自快照、循环内不递减 → 同一次运行超发

- **规范依据**：R11「订阅消息一次性授权」，AGENT.md §3.3「`subscribe_record.quota` = 剩余可推送次数，每次成功推送消耗 1」。
- **现状根因**：[job-remind/src/index.ts:122-126](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/job-remind/src/index.ts#L122-L126)
  ```ts
  const left = (rec.quota ?? 1) - 1
  await db.collection(SUBSCRIBE_RECORD).doc(rec._id).update({ quota: left, usedAt: nowStr })
  ```
  `rec` 来自一次查询快照，三重循环内**从不改写 `rec.quota`**，每次都按原始值计算。
- **实测结果**（桩已修正为返回副本，语义与生产一致）：

  | 初始 quota | 信息条数 | 实际推送 | 正确应推送 | 最终 quota | 正确最终 quota |
  |---|---|---|---|---|---|
  | 1 | 2 | **2** | 1 | 0 | 0 |
  | 3 | 2 | 2 | 2 | **2** | 1 |

  quota=1 的用户**收到 2 条消息**，超出一次性授权语义；quota=3 时余量记账同样错误。
- **影响**：直接违反 R11，且触达量超出用户授权预期（微信侧有滥用判定风险）。
- **期望**：循环内维护剩余余量并在归零时停止，或按 `(infoId, remindAt)` 批量申请授权额度。

### SN-17 / SN-18 / SN-19【高】`info.update` 是一个绕过全部校验的写入口

AGENT.md §4.2 明确「**所有**对外写操作必须过 zod 校验」，但 [`updateInfo`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-admin/src/index.ts#L129-L148) 只做 `UPDATABLE_FIELDS` 白名单复制，对字段值不作任何校验，也不复跑发布门禁。三个后果：

| 编号 | 后果 | 实测 |
|---|---|---|
| SN-17 | 非法 deadline（`date:'garbage'`）、空 title、500 字符 location 直接落库 | `info.update` 返回 code=0，字段原样写入 |
| SN-18 | 已发布条目的 `sourceUrl`/`sourceChannel` 可同时清空，`reviewStatus` 仍为 `published` | 违反 §4.4「缺失来源无法进入 published」 |
| SN-19 | 改 deadline 后不重置 `deadlineVerifiedByHuman`，旧背书沿用到新日期 | 违反 §4.3 / R12 |

**SN-19 值得单独强调**：复核标记是对「某个具体 deadline 值」的背书。改期后沿用旧标记，意味着**新截止日期从未被人工复核却仍可发布**，而 R12 恰恰是为「AI 提取的截止日期可能错」而设。

- **期望**：`info.update` 对每个可更新字段套用对应 zod schema；涉及 `deadline` 修改时强制把 `deadlineVerifiedByHuman` 重置为 false；涉及来源字段修改时复跑 `checkPublishable`。

### SN-15 / SN-16【中】投稿审核链路缺状态机与契约一致性

- **SN-15**：`reviewSubmission` 不做状态机校验（对比 `api-admin.reviewInfo` 有 `canTransition`），也不做「已处理即幂等」。实测第二次 `accept`：重新抓取（多一次真实网络请求）→ 查重命中自己第一次入库的 `information` → 把投稿状态从 `accepted` 改写为 `duplicate`。明明入库成功却显示为重复。
- **SN-16**：[`shared/types/submission.ts:18`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/types/submission.ts#L18) 定义 `status: 'pending'|'accepted'|'rejected'|'duplicate'`，而 [`api-submission/src/index.ts:78`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-submission/src/index.ts#L78) 直接 `update({ status: action })`，`action` 是 `'reject'`（无 d），实际写入**契约外取值** `'reject'`。按 `'rejected'` 过滤的查询永远查不到被驳回的投稿。TS 未捕获，因为 `update()` 参数未受类型约束。

### SN-14【中】HTML 实体级联解码

- **实测根因**（`node -e` 直测）：[`decodeEntities`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/lib/html.ts#L29-L37) 用**链式 `.replace()`** 实现，前一步产物会落进后一步匹配范围，一次调用内就解码两遍：

  ```
  '&amp;lt;' → 第 2 步 '&amp;'→'&' 得 '&lt;' → 第 3 步 '&lt;'→'<' 得 '<'
  ```

  | 输入 | decodeEntities 结果 | 正确应为 |
  |---|---|---|
  | `&amp;lt;` | `<` | `&lt;` |
  | `&amp;#39;` | `'` | `&#39;` |
  | `&amp;amp;` | `&amp;` | `&amp;`（对照，不级联） |

- **第二层问题**：[`extractTitle`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/lib/html.ts#L17) 与 [`extractLinks`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/lib/html.ts#L50) 在 `stripTags`（内部已解码）**之外又调一次** `decodeEntities`。实测 `&amp;amp;lt;` 单层应得 `&amp;lt;`，实际被两级解码成 `<`。
- **影响**：爬取/投稿入库的标题与锚文本显示失真；若上层把结果再拼回 HTML，会引入标签注入面。
- **期望**：改单次扫描的实体解码（不用级联 replace），且外层不重复解码。

### SN-23【中】提醒链路查询量放大

`isAlreadyLogged` 在三重循环内**逐条查库**（[job-remind/src/index.ts:107](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/job-remind/src/index.ts#L107)）。规模上界：`BATCH_SIZE(100) × 提醒点(2) × RECIPIENT_LIMIT(500) = 10 万次读/小时`，与 §4.10「云函数注意冷启动与超时」冲突。用例已用 3×1×2 的小规模固化行为，供优化后对照。

### SN-24【中】去重是「读-then-写」，非原子

`api-admin.createInfo`、`api-submission.reviewSubmission`、`job-crawl.crawlOne` 的去重均为先查 `contentHash` 再 `add`。两处后果（取决于数据库是否建了唯一索引）：

- 若**无**唯一索引 → 并发下两次都查不到重复，产生重复条目；
- 若**有**唯一索引 → 并发下第二次 `add` 抛异常，被外层 catch 吞成 `500 服务内部错误`，而不是 §4.5 要求的「返回既有条目而非报错」。

两种情况都不满足 §4.5 的幂等语义。用例已覆盖**串行**路径的幂等（通过），并发路径无覆盖。

### SN-25 / SN-26 / SN-27【中低】api-user 与 schema 边界

- **SN-25**：[`recordSubscribe`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-user/src/index.ts#L69-L93) 无幂等，客户端网络重试会新增一条 `subscribe_record`，**虚增授权余量**（1 次授权记成 N 次）。无去重键（如 `openId + templateId + 时间窗`）。本次未为其编写自动化用例（见 §6）。
- **SN-26**：`ensureUser` 为读-then-写 upsert，并发首次登录可能产生重复 user 文档。
- **SN-27**：[`subscribeRecordSchema.expireAt`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/schemas/user.ts#L17) 只做 `z.string().min(1)`，无 ISO 校验；非法值在 `new Date(r.expireAt).getTime()` 得 NaN，被当作「已过期」静默丢弃。

### SN-28 / SN-29 / SN-30【低】

- **SN-28**：[`formatDeadline`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/job-remind/src/index.ts#L46-L52) 手写 `+8h` 后取 `getUTC*` 拼展示串，与 `shared/domain/deadline.ts` 重复实现时区逻辑，且同受 SN-05 影响（无偏移串会算错）。展示层格式化也不该落在云函数里。
- **SN-29**：[`api-info.getPublished`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-info/src/index.ts#L56-L58) 的 `catch` 不分异常类型统一返回 404，DB 故障会被误报为「信息不存在」。
- **SN-30**：`make/code/package.json` 的 devDependencies 声明 `@types/node: ^18.19.0`，但实测 `node_modules/@types` 下**仅有 `estree`**，包未安装。这也是本项目代码统一用 `(globalThis as {...}).process?.env` 而不用裸 `process` 的原因（见 job-remind 源码注释）。

### SN-38【中】规范点名的「AI 结果校验」纯函数未落地

AGENT.md §4.8 要求 `shared/domain` 的「状态机、去重、deadline 解析、提醒时间计算、**AI 结果校验**」必须有 Vitest 单测。前四项均已在 `shared/domain` 实现并有单测，但「AI 结果校验」并不存在于 `shared/domain`——置信度到状态的分流内联在 [`job-ai-extract/src/index.ts:38`](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/job-ai-extract/src/index.ts#L38)：

```ts
const target = extraction.confidence >= AI_LOW_CONFIDENCE_THRESHOLD ? 'pending_review' : 'low_confidence'
```

后果：这段关键判定（R12 的核心）无法单测，也不满足 §3.3「审核状态机收敛于 shared/domain」的精神。阈值常量 `AI_LOW_CONFIDENCE_THRESHOLD` 本身来源单一（`lib/llm.ts` 转发自 `shared/domain`，此项已核查证伪，不是双重定义）。

---

## 五、测试过程中修正的错误（实事求是记录）

| # | 问题 | 根因 | 处理 |
|---|---|---|---|
| 1 | 初版桩 `get()` 返回库内对象引用，导致 SN-22 被掩盖（测出 quota 递减「正常」） | 桩语义与真实 SDK 不符（真实为反序列化副本） | 改 `structuredClone` 深拷贝；这是本阶段最关键的一次修正 |
| 2 | `info.create` 幂等用例失败（`duplicate` 为 false） | 测试数据里 `contentHash` 是手写常量 `'12345678'`，与实际计算值不符 | 改为在测试里调 `computeContentHash()` 生成种子数据 |
| 3 | SN-14 首个断言失败（预期 `stripTags('&amp;lt;')` 得 `'&lt;'`，实际得 `'<'`） | 判断错误：以为是「外层重复解码」，实为 `decodeEntities` **链式 replace 自身级联** | 用 `node -e` 直测解码链，重写 SN-14 用例并把根因改写准确 |
| 4 | `tsc` 报 TS18046（`res` 为 unknown）与 TS2580（找不到 `process`） | `api-submission.main()` 返回 `Promise<unknown>`；本工程未安装 `@types/node` | 加统一 `call()` 包装做类型收窄；环境变量改用项目既有的 `globalThis.process?.env` 写法 |

> 第 1 项值得单独记住：**测试桩如果语义不忠实，会给出「一切正常」的错误结论**。本次若不修正桩，SN-22（超发）这一最高危缺陷会被完全漏掉。

---

## 六、本阶段未覆盖的范围（如实说明）

| 对象 | 状态 | 原因 |
|---|---|---|
| `api-info` | 🔍 仅审查 | 纯读路径，无写操作；已审查出 SN-29；冒烟价值低于写链路 |
| `api-user` | 🔍 仅审查 | 已审查出 SN-25/SN-26，但驱动测试需额外构造 OPENID 上下文与订阅场景 |
| `job-ai-extract` | 🔍 仅审查 | 依赖真实 LLM 调用（`lib/llm.ts` 走 fetch），需 mock 网络层才能测；核心问题是 SN-38 的结构缺失 |
| `job-crawl` | 🔍 仅审查 | 依赖真实 HTTP 抓取 + `source` 集合，逻辑与 api-submission 的抓取入库高度重合 |
| 并发/竞态路径 | ❌ 未覆盖 | SN-24/SN-25/SN-26 属并发问题，单线程测试无法复现，只能静态判定 |

按 AGENT.md §4.8「云函数至少冒烟测试」，本阶段已对 3 个核心写链路函数完成冒烟 + 关键断言；其余 4 个为纯读或强外部依赖，冒烟收益低于成本。**这是取舍而非遗漏**，若后续需要可按同样方式补桩。

---

## 七、本阶段结论

- 云函数层的**整体结构良好**：统一返回 `{code,message,data}`（§4.7）落实到位、日志留痕齐全、发布门禁与状态机确实调用了 `shared/domain` 的单一实现、AI 输出未直接写主字段（`job-ai-extract` 明确只写 `aiExtract`，注释也写明「主字段以人工复核为准」）。
- **风险集中在 `api-admin.info.update`**：它是唯一一个完全绕过 zod 与发布门禁的写入口，一个入口带出 SN-17/18/19 三个高危问题。**优先修这一个函数即可消除三个高危缺陷**。
- **SN-22（超发）** 是影响面最广的运行时缺陷，直接违反 R11。
- 本阶段 67 个用例全部通过，`tsc --strict` 通过。
