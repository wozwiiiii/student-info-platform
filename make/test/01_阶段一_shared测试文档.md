# 阶段一 · shared 共享层 审查与 TDD 测试文档

> 阶段目标：对 `make/code/shared/`（类型 + zod schema + 领域纯函数）做代码审查，并补齐 TDD 单测。
> 选择 shared 作为第一阶段的理由：它是小程序 / 云函数 / 后台三方的**单一事实来源**，且全部为纯函数与纯数据结构，最适合 TDD 完整验证；其缺陷会同时扩散到三个消费方，优先级最高。
> 审查基准：`make/code/AGENT.md` §4.1–§4.5、§3.3 时间规则与数据模型硬约束。

---

## 一、测试范围与方法

| 项目 | 内容 |
|---|---|
| 覆盖对象 | `shared/domain/*`（4 个纯函数模块）、`shared/schemas/*`（3 个 zod schema） |
| 方法 | 先读源码形成审查结论 → 为结论写断言 → **运行验证断言是否与实际一致** → 不一致则实测根因并修正断言 |
| 测试框架 | Vitest 2.1.9，`environment: node` |
| 执行命令 | `node node_modules\vitest\vitest.mjs run` |

**缺陷用例的约定**：以 `【缺陷 SN-xx】` 开头的 describe 块断言的是**当前实际行为**（characterization test），非期望行为。目的是保持测试全绿的同时把缺陷固化下来；一旦修复，断言变红，强制同步更新。

---

## 二、测试结果

| 测试文件 | 用例数 | 结果 | 说明 |
|---|---|---|---|
| `shared/domain/__tests__/deadline.test.ts` | 23 | ✅ 全通过 | 既有 9 条 + 新增 14 条 |
| `shared/domain/__tests__/content-hash.test.ts` | 8 | ✅ 全通过 | 既有 4 条 + 新增 4 条 |
| `shared/domain/__tests__/publish-gate.test.ts` | 7 | ✅ 全通过 | 既有 4 条 + 新增 3 条 |
| `shared/domain/__tests__/review-state.test.ts` | 5 | ✅ 全通过 | 既有，未改动 |
| `shared/schemas/__tests__/information.test.ts` | 18 | ✅ 全通过 | **全新**（此前该 schema 零覆盖） |
| `shared/schemas/__tests__/submission.test.ts` | 9 | ✅ 全通过 | **全新**（此前零覆盖） |
| `shared/schemas/__tests__/user.test.ts` | 4 | ✅ 全通过 | 既有，未改动 |
| **合计** | **74** | **74/74 通过** | 基线 26 → 74（+48） |

`node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json` → **exit 0**（strict 通过）。

---

## 三、用例明细

### 3.1 informationCreateSchema（18 条，全新）

| 分组 | 用例 | 断言要点 | 结果 |
|---|---|---|---|
| 可溯源硬校验 | sourceUrl 与 sourceChannel 同空 → 失败 | 对应 §4.4 | ✅ |
| | 仅 sourceChannel 非空 → 通过 | OR 语义 | ✅ |
| | 仅 sourceUrl 非空 → 通过 | OR 语义 | ✅ |
| | 空白字符不算来源 | trim 后判定 | ✅ |
| 默认值 | `deadlineVerifiedByHuman` 默认 false | | ✅ |
| | sourceUrl/sourceChannel 缺省补空串 | | ✅ |
| | title 去首尾空白 | | ✅ |
| 边界长度 | title 超 200 拒绝 / 空拒绝 / 恰 200 通过 | | ✅ |
| | category、sourceType 非法枚举拒绝 | | ✅ |
| | eventTime 复用 deadline 校验 | 正常值通过、非法值拒绝 | ✅ |
| 合法值 | date 精度格式校验（含 `2026-1-4`、带时间串拒绝） | | ✅ |
| 【缺陷 SN-01】 | 客户端传 `deadlineVerifiedByHuman:true` 被接受 | 见 §4 | ✅ |
| 【缺陷 SN-02】 | `tz:'UTC'`、`tz:'随便写'` 被接受 | 见 §4 | ✅ |
| | datetime 精度下无偏移裸串被接受 | 见 §4 | ✅ |
| | tz 缺省补 `Asia/Shanghai` | | ✅ |
| 【缺陷 SN-08】 | `2026-02-30` 被判合法（date 与 datetime 两种精度） | 见 §4 | ✅ |
| | 对照：`2026-13-01` 月份越界被拒绝 | 说明仅日域未校验 | ✅ |

### 3.2 submissionCreateSchema（9 条，全新）

| 分组 | 用例 | 断言要点 | 结果 |
|---|---|---|---|
| url 校验 | 合法 http/https 通过 | | ✅ |
| | 非 URL / 空 / 缺字段 / 超长拒绝 | | ✅ |
| 选填字段 | sourceChannel / note 选填 | | ✅ |
| | note 超 500、sourceChannel 超 200 拒绝 | | ✅ |
| | url 首尾空白裁剪 | | ✅ |
| 【缺陷 SN-03】 | schema 不接受也不校验 `aiPreReview`（多余字段被剥离） | 见 §4 | ✅ |
| 【缺陷 SN-09】 | ftp / javascript / file 协议被接受 | 见 §4 | ✅ |
| | 环回 `127.0.0.1`、元数据 `169.254.169.254`、私网 `10.0.0.1` 被接受 | 见 §4 | ✅ |

### 3.3 deadline（23 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| getDeadlineInstant | date 精度取当天 23:59:59+08:00；datetime 取原时刻 | ✅ |
| isValidDeadline | date 精度只收 YYYY-MM-DD；非法串拒绝 | ✅ |
| computeReminderSchedule | date 精度排截止前 3/1 天 09:00；已过不排；datetime 按 N×24h 前推 | ✅ |
| dueReminderPoints | 只返回 (now-window, now] 区间；空窗返回空；未来不提前 | ✅ |
| 边界区间 | 恰等于 now → 包含（右闭）；恰等于 now-window → 排除（左开）；晚 1ms → 包含；早 1ms → 排除 | ✅ |
| 【缺陷 SN-04】 | tz=UTC 仍按 +08:00；tz 任意值不影响结果 | ✅ |
| 【缺陷 SN-05】 | 无偏移裸串被判合法；datetime 下 date-only 被当 00:00Z | ✅ |
| 【缺陷 SN-06】 | hourOfDay=25 / -1 → 提醒点静默丢弃；hourOfDay=24 → 被当次日 00:00；负 offsetsDays → 排出截止之后的点；合法 0/23 正常 | ✅ |
| 【缺陷 SN-07】 | date 精度下长串被判非法，但下游 slice 解析仍产出正确时刻 | ✅ |

### 3.4 content-hash（8 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| normalizeTitle | 空白/标点/大小写归一；`a-b_c` → `abc` | ✅ |
| hashString | 同输入稳定、异输入不同 | ✅ |
| computeContentHash | 标题归一 + 渠道决定哈希；不同渠道不去重；渠道大小写与空白归一 | ✅ |
| 【缺陷 SN-10】 | 实证碰撞对 `竞赛通知72vu` / `竞赛通知euea` 同为 `6c90a521` | ✅ |
| 【缺陷 SN-11】 | 纯符号标题互相碰撞；空标题与纯符号标题碰撞 | ✅ |

### 3.5 publish-gate（7 条）

| 分组 | 用例 | 结果 |
|---|---|---|
| checkPublishable | 无来源禁发；deadline 未复核禁发；有来源+已复核可发；无 deadline 不校验复核标记；空白来源视为缺失 | ✅ |
| 【缺陷 SN-12】 | 只填 sourceChannel、sourceUrl 为空 → 允许发布（OR 语义） | ✅ |
| 【缺陷 SN-13】 | sourceType 不参与发布门禁判定 | ✅ |

### 3.6 review-state（5 条，既有未改动）

主链路迁移、低置信度强制人工、任意态可 rejected/corrected、禁止跳跃发布与自身迁移、`expectTransition` 非法迁移抛错。全部通过，**未发现缺陷**。

---

## 四、本阶段缺陷明细

### SN-01【高】`deadlineVerifiedByHuman` 可由写入方自报

- **规范依据**：AGENT.md §4.3「截止日期必须**人工复核**后才可 published」。该字段语义是「审核员已复核」。
- **现状根因**：[information.ts](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/schemas/information.ts) 中 `deadlineVerifiedByHuman: z.boolean().default(false)` 允许写入方直接提交 `true`；[api-admin/src/index.ts:57](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-admin/src/index.ts#L57) 原样持久化；发布时 [api-admin/src/index.ts:97-108](file:///d:/my_try_program/prom_1_student_information/trae/make/code/cloudfunctions/api-admin/src/index.ts#L97-L108) 直接采信该值。
- **影响**：`info.create` 传 `deadlineVerifiedByHuman:true` → 后续 publish 门禁直接放行，全程**没有任何独立的复核动作**。§4.3 的底线被退化成「字段为 true 即可」。
- **期望**：写入侧强制 `false`（schema 层不接受该字段，或服务端覆盖为 false）；仅 `info.review` 审核动作可置 `true`。
- **验证**：`information.test.ts`「【缺陷 SN-01】」+ `api-admin.test.ts`「【缺陷 SN-01】」两个用例（含「自报 true 后可直接发布」的端到端链路）。

### SN-02 / SN-04 / SN-05【中】时区字段与显式偏移约束双双失效

- **规范依据**：AGENT.md §3.3「存储一律 ISO 8601 + **显式时区偏移**」；`DeadlineInfo.tz` 注释为「固定 Asia/Shanghai」。
- **现状根因**（三层叠加）：
  1. `deadlineSchema` 对 `tz` 只做 `z.string()`，不约束取值（[information.ts:15](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/schemas/information.ts#L15)）；
  2. [deadline.ts:8](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/domain/deadline.ts#L8) 硬编码 `TZ_OFFSET='+08:00'`，**全程不读 `deadline.tz`**；
  3. `isValidDeadline` 对 datetime 精度只判 `new Date(x)` 非 NaN，接受 `2026-11-04T18:00:00` 与 `2026-11-04` 这类无偏移串。
- **影响**：`tz` 形同虚设；无偏移裸串的解析结果随运行环境时区漂移（云函数运行环境与用户设备可能都非 +8），截止时刻与提醒时间会算错。
- **期望**：schema 强制 `tz === 'Asia/Shanghai'`（或真按 tz 解析）；datetime 精度强制匹配 `[+-]\d{2}:\d{2}$|Z$`。

### SN-06【中】提醒排程入参无范围校验，非法值静默丢提醒

- **现状根因**：[deadline.ts:22-25](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/domain/deadline.ts#L22-L25) 的 `morningOf` 用 `String(hourOfDay).padStart(2,'0')` 拼时间串；`hourOfDay=25` → `T25:00:00` → Invalid Date → 被 `d.getTime() > now.getTime()` 的 NaN 比较**静默过滤**。
- **实测行为差异**：`hourOfDay=25`/`-1` → 提醒点消失；`hourOfDay=24` → ISO 8601 视 `24:00:00` 为当日结束，被解析为**次日 00:00**，越界却不报错。三者行为互不一致。
- **影响**：配置错误不会报错、不会告警，只表现为「用户没收到提醒」，极难排查。
- **期望**：入参范围校验（`hourOfDay ∈ [0,23]`、`offsetsDays` 非负），非法即抛错。

### SN-08【中】不存在的日历日期可入库

- **实测证据**（`node -e` 直测）：
  | 输入 | `new Date(...)` 结果 |
  |---|---|
  | `2026-02-30T00:00:00+08:00` | `2026-03-01T16:00:00.000Z`（**顺延，非 Invalid**） |
  | `2026-02-30` | `2026-03-02T00:00:00.000Z`（顺延） |
  | `2026-13-01` | `Invalid` |
- **结论**：V8 对**日域越界**会顺延、对**月域越界**才拒绝。`isValidDeadline` 依赖 `!Number.isNaN(...)`，因此 2 月 30 日这类不存在的日期被判合法并可写库。
- **期望**：显式校验年月日范围（含闰年 2/29）。

### SN-09【中】投稿 URL 校验不限协议、不拒内网地址

- **实测证据**（zod v3 `z.string().url()`）：

  | 输入 | 结果 |
  |---|---|
  | `ftp://example.edu/a` | ✅ 接受 |
  | `javascript:alert(1)` | ✅ 接受 |
  | `file:///etc/passwd` | ✅ 接受 |
  | `http://127.0.0.1/x` | ✅ 接受 |
  | `http://169.254.169.254/latest/meta-data/` | ✅ 接受 |
  | `not-a-url` | ❌ 拒绝 |

- **原因**：`.url()` 底层是 `new URL()`，只校验可解析性，不限协议、不看网段。
- **影响链路**：`api-submission` 会对该 URL 执行 `fetchText(sub.url)`（服务端抓取），用户可让云函数访问环回/私网/元数据地址 → **SSRF 面**。
- **期望**：限定 http/https 协议 + 拒绝环回、链路本地、私网地址段。

### SN-10【中】去重哈希存在实证碰撞

- **现状**：`contentHash` 为 **32 位 FNV-1a**（[content-hash.ts:14-25](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/domain/content-hash.ts#L14-L25)），且被当作 `information` 的**唯一索引**（§3.3）用于去重。
- **实测证据**：穷举 692,579 个标题即命中碰撞对：

  ```
  标题A = "竞赛通知72vu"   → 归一化 "竞赛通知72vu"
  标题B = "竞赛通知euea"   → 归一化 "竞赛通知euea"   （二者不同）
  contentHash = 6c90a521   （二者相同）
  ```

- **影响**：两条**不同的真实信息**被判为重复，后者被直接丢弃（§4.5「重复提交返回既有条目」），用户永远看不到这条信息。按生日问题，约 7.7 万条时碰撞概率达 50%。
- **期望**：换更强哈希（如 SHA-256 截断），或唯一索引冲突时退化为「并存 + 人工判定」而非丢弃。

### SN-11 / SN-07 / SN-13【低】一致性瑕疵

- **SN-11**：`normalizeTitle` 去掉全部空白/标点/符号后，纯符号标题（`！！！`、`？？？`、`---`）归一化结果均为空串，共享同一哈希，甚至与空标题碰撞。
- **SN-07**：`isValidDeadline` 对 date 精度用正则严格要求长度 10，但 `getDeadlineInstant` / `computeReminderSchedule` 用 `date.slice(0,10)` 宽容更长串——同一个值可能被判非法却被下游正常解析，两处契约不一致。
- **SN-13**：`checkPublishable` 只看 `sourceUrl` / `sourceChannel`，不校验 `sourceType`，尽管 §3.3 将其列为 information 关键字段。

### SN-12【中】规范自相矛盾（不是代码缺陷，但会让实现无所适从）

| 出处 | 原文 | 语义 |
|---|---|---|
| AGENT.md §3.3 数据模型 | `sourceUrl+sourceChannel 必填` | AND（两个都要） |
| AGENT.md §4.4 | `sourceUrl \|\| sourceChannel 缺失的记录无法进入 published` | OR（至少一个） |

代码实现的是 **OR**（[publish-gate.ts:20](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/domain/publish-gate.ts#L20)）。需在 AGENT.md 收敛为单一结论后，再决定是否调整代码。

### SN-03【低】`aiPreReview` 名实不符

`Submission.aiPreReview` 类型含 `duplicateInfoId?`（[submission.ts:15](file:///d:/my_try_program/prom_1_student_information/trae/make/code/shared/types/submission.ts#L15)），但 `api-submission` 从未填写该字段；`legalSource` 由 `/^https?:\/\//.test(url)` 得出，因 schema 已强制 `.url()` 而恒为 true；`confidence` 硬编码 `0.5`，无任何推导依据。字段名为「AI 预审」，实际是规则判断 + 固定常量。

---

## 五、测试过程中修正的错误（实事求是记录）

初次编写断言时有 **4 处与实际行为不符**，全部经实测后修正。记录如下，避免后续误判：

| # | 原断言 | 实测结果 | 根因 | 处理 |
|---|---|---|---|---|
| 1 | `hourOfDay=24` → 提醒点为「当天 00:00」 | 实为「次日 00:00」 | ISO 8601 把 `24:00:00` 定义为当日结束 | 修正断言，并入 SN-06 |
| 2 | 提醒点比 `now-window` 晚 1ms → 包含 | 实际被排除 | 时间参数写反（now 设成 11:00:00.001 使窗口左界变成 09:00:00.001） | 修正 now 取值，并补一条反向用例 |
| 3 | `2026-02-30` → 校验失败 | 实际**通过** | V8 对日域越界做顺延而非拒绝 | 改为锁定现状，升级为 SN-08 |
| 4 | `ftp://` / `javascript:` → 校验失败 | 实际**通过** | zod `.url()` 不限协议 | 改为锁定现状，升级为 SN-09 |

> 这 4 次修正说明：**未经实测的推断不能作为审查结论**。后续所有缺陷判定均以运行结果或 `node -e` 直测为准。

---

## 六、本阶段结论

- shared 层的**架构与规范落地度高**：类型单一来源、zod 校验覆盖面完整、发布门禁与状态机各自收敛为单一纯函数（符合 §3.3「禁止散落 if-else」）。
- 主要问题集中在**边界与契约**：时区（SN-02/04/05）、日历合法性（SN-08）、入参范围（SN-06）、哈希强度（SN-10）。
- **最需要优先处理的是 SN-01**：它是唯一一个会让 §4.3「人工复核」底线失效的问题，且在 shared 层即可修（schema 不接受该字段）。
- 本阶段 74 个用例全部通过，`tsc --strict` 通过，可作为回归基线。
