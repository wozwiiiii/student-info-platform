# AGENT.md · 大学生信息数据中台 · 开发总规范

> **本文件地位**：`make/code` 下所有开发工作的唯一规范来源。每次开发前必读，每次修改后按第 9 节规则回写。
> **输入依据**：`spec/01_产品思考文档_v1.0.md`（功能清单第 2 节、风险清单第 5 节）与 `spec/00_目录总文件.md`（五轮问答决策）。
> **事实标注约定**：【已确认】= 产品文档明确的结论；【假设】= 有依据但未验证，需上线验证；【客观事实】= 外部平台规则/技术约束，不可改变。
> **原则**：实事求是、客观、第一性原理——从「约束 → 目标」推导方案，不为不存在的需求付费，不回避客观限制。

---

## 1. 项目一句话与工程目标

面向单校试点的大学生信息聚合数据中台（微信小程序 + 录入/审核后台 + 采集管线），把分散的教务/就业/学院信息聚合为**结构化、可溯源、带截止提醒**的统一入口。

工程目标按优先级（第一性原理：目标决定一切技术取舍）：

1. **信息质量 > 信息数量**：一条错误/过期信息的信任代价 > 少十条信息 → 代码层必须强制「可溯源 + 审核后发布」。
2. **截止时间是第一公民**：deadline 是核心价值 → 数据模型、提醒链路、UI 权重均以 deadline 优先。
3. **单兵可维护**：MVP 由一人运营（采集→审核→发布）→ 技术栈必须低运维、低成本、少服务器工作。
4. **快速验证假设**：产品文档第 6 节的假设（用户是否用路线图/是否投稿/触达率）需要数据支撑 → 埋点与指标先行设计。

---

## 2. 技术栈（决策 + 理由 + 重评估条件）

### 2.1 决策表

| 层 | 选型 | 说明 |
|---|---|---|
| 小程序端 | **Taro 4.1.9 + React + TypeScript + Webpack5 + Sass**，目标平台 weapp（WebView 渲染，不用 Skyline），开发/预览/诊断/上传走 miniapp-builder 插件工具链 | 【已确认】用户指定使用 miniapp-builder 插件开发；该插件工具链仅支持 Taro 项目（2026-10-28 决策推翻，见 2.2）；多端扩展（H5/App）顺带受益 |
| 后端 | **微信云开发 CloudBase**：云函数（Node.js + TypeScript）+ 云数据库 + 云存储 + 定时触发器 + HTTP API | 免服务器运维、免 ICP 备案接入（小程序端走 `wx.cloud` 不受合法域名限制）、云调用可直接下发订阅消息（免 access_token 管理） |
| 云函数组织 | 按领域拆 6 个：`api-info`、`api-submission`、`api-admin`、`job-crawl`、`job-ai-extract`、`job-reminder`；内部薄路由，单函数多 action | 兼顾冷启动体积与领域边界，不引入 Nest 等重框架 |
| 管理后台 | **Vue 3 + Vite + TypeScript + Element Plus**，云开发静态托管 | 录入/审核/路线图维护是重表单表格场景，PC Web 最合适；单人开发成本最低的成熟组合 |
| AI 结构化 | **OpenAI 兼容接口**（默认 DeepSeek，baseURL/key 可配置），自封装 `LLMProvider` 接口 | 【客观事实】LLM 供应商会变、价格会变 → 只依赖 OpenAI 兼容协议，可随时切换 |
| 采集脚本 | Node.js（`undici` + `cheerio`）跑在定时触发器；**JS 渲染页面 / 公众号监控在运营者本机跑**（`tools/` 目录，Playwright 可选），半自动人工确认后入库 | 【客观事实】云函数不适合长驻进程与重型 headless 浏览器；「半自动 + 人工确认」本就是 B1 的产品定义 |
| 共享层 | `shared/` 纯 TypeScript：类型 + zod 校验 schema + 常量，小程序/云函数/后台三方共用 | 类型单一事实来源，防止前后端字段漂移 |
| 质量工具 | ESLint + Prettier + `tsc --strict` + Vitest（单测） | 见第 6 节底线 |
| 版本管理 | Git，Conventional Commits | 见第 8 节 |

### 2.2 明确不选（及理由）

| 不选 | 理由 |
|---|---|
| ~~原生小程序（首版决策）~~ | **已推翻（2026-10-28）**：原理由是「MVP 只有小程序载体，跨端抽象是成本」；推翻原因是用户指定 miniapp-builder 插件开发，其构建/预览/诊断/上传工具链仅支持 Taro 项目——工具链收益 > 抽象成本，且多端扩展顺带受益。抽象成本的控制手段不变：领域逻辑收敛在 `shared/`，视图层保持薄 |
| uni-app | 与 Taro 同类框架二选一即可；已选 Taro（工具链约束） |
| 自建服务器（VPS + NestJS/Python + PostgreSQL） | 单兵运维负担（备案、证书、监控、备份）违背目标 3。**重评估条件**：云开发无法满足的场景明确出现（复杂关系查询/统计性能、需要长驻爬虫进程、多端同服），届时迁移数据库层，云函数逻辑可复用 |
| 微信云开发静态 CMS / 第三方 BaaS | 引入第二套数据源，违背「数据中台」单一事实来源 |
| ORM（TypeORM/Prisma） | 云数据库是文档型，ORM 收益低、适配差；用薄数据访问层 + zod 校验 |

### 2.3 Taro 开发要点（跨端红线）

- 一律使用 `@tarojs/components` 与受支持的 Taro API；**禁止依赖浏览器 DOM / ReactDOM / 内联 `<svg>`**（小程序不支持；SVG 用 `Image` 引用且资源内不用百分比单位与 `<style>`）。
- 平台差异用 `process.env.TARO_ENV`（不解构）分支；`app.config` 等配置在源码中按环境分支，**不直接改生成产物 JSON**。
- `Image` 显式设置尺寸与 `mode`；tabBar 图标用项目内图片（符合平台尺寸要求），不填网络 URL。
- 跨端字段/类型一律来自 `shared/`（alias `@shared`），视图层保持薄——这是「抽象成本可控」的实现手段。

---

## 3. 整体架构

### 3.1 分层与数据流

```
[信息源] 公众号(半自动/本机tools) ─┐
          学校官网(定时爬取)      ─┼─→ 采集/投稿入口 ─→ AI 结构化(LLMProvider)
          用户投稿(小程序)        ─┘         │
                                            ▼
                              审核状态机（AI 预审 + 人工复核关键字段）
                                            │
                                            ▼
                              云数据库 information（已发布）
                                │            │
              小程序信息流/分类频道(A1/A2)   Deadline 日历+订阅消息(A3)
                                │
                          简版成长路线图(A4) ← roadmap_node（关联实时信息）
```

### 3.2 目录结构（`make/code`）

```
code/
├── AGENT.md                  # 本文件（唯一规范来源）
├── project.config.json       # 小程序项目配置
├── shared/                   # 共享：类型 / zod schema / 常量 / 领域纯函数
│   ├── types/                #   information.ts, submission.ts, roadmap.ts ...
│   ├── schemas/              #   zod 校验（所有对外写操作入口必须过 schema）
│   └── domain/               #   纯函数：去重hash、deadline解析、状态机、提醒时间计算
├── miniprogram/              # Taro 项目根（插件 projectRoot；src/ 页面按 tab 划分：信息流/分类/日历/路线图/我的）
├── cloudfunctions/           # 6 个云函数（见 2.1）
├── admin/                    # Vue3 管理后台（录入/审核/来源管理/路线图维护/数据看板）
├── tools/                    # 本机半自动采集工具（公众号监控、渲染页爬取），不部署
└── docs/                     # 仅存放开发期必要决策记录（非产品文档，产品文档在 spec/）
```

### 3.3 核心数据模型（关键约束）

| 集合 | 关键字段 | 硬约束（代码层强制） |
|---|---|---|
| `information` | title, category(机会成长/奖助评优/教务通知/讲座活动), subType(竞赛/就业实习/保研…), deadline{date, precision: date\|datetime, tz: Asia/Shanghai}, eventTime, location, targetAudience, **sourceUrl, sourceChannel, sourceType(公众号/官网/投稿/人工)**, contentHash, aiExtract{fields, confidence}, reviewStatus, publishedAt, expiredAt | **sourceUrl 与 sourceChannel 至少一个非空**（产品原则 4「不做无来源信息」；与 §4.4 一致，2026-10-31 收敛，原「两者必填」与 §4.4 自相矛盾，已按代码实现统一为 OR）；contentHash 唯一索引（去重）；reviewStatus 状态机之外禁止发布 |
| `submission` | submitterOpenId, url, note, aiPreReview{合法来源, 重复检测}, status | AI 预审结论只做建议，入库/驳回必经人工 |
| `source` | name, type, monitorMethod, lastFetchedAt, reliability | 爬取失败率与可靠性留痕（R10） |
| `roadmap_node` | year/semester, title, typicalWindow, relatedCategory, **lastMaintainedAt** | lastMaintainedAt 必填（R8 路线图过期风险：节点必须标注整理时间） |
| `user` | openId, college, grade(选填), subscribeState | 标签数据为 V1 过滤（A7）积累 |
| `review_log` | infoId, operator(AI/人工), action, diff | 全审核链路可追溯 |
| `subscribe_record` | openId, templateId, subscribedAt, usedAt | 【客观事实】订阅消息一次性授权 → 记录授权余量（R11） |

**审核状态机**（`shared/domain` 纯函数实现，禁止散落 if-else）：

```
collected → ai_extracted → pending_review → published → archived/expired
                    ↘ low_confidence ──────→ pending_review（强制人工）
任意态 → rejected / corrected（纠错走 review_log 留痕）
```

**时间规则**：存储一律 ISO 8601 + 显式时区偏移，展示层统一格式化为 `Asia/Shanghai`；禁止存储本地化字符串；deadline 需区分「仅日期 / 含时刻」精度（precision 字段）。

---

## 4. 代码核心要求（底线，非建议）

1. **TypeScript strict 全线**：`miniprogram / cloudfunctions / admin / shared` 全部 TS；禁 `any`（确需时 `unknown` + 收窄）。
2. **单一类型来源**：跨端字段一律定义在 `shared/types`，zod schema 定义在 `shared/schemas`；**所有对外写操作（HTTP/云函数/后台表单）必须过 zod 校验**，校验失败返回统一错误码。
3. **AI 输出永远不直接发布**（产品 4.2 底线 + R12）：LLM 结果写入 `aiExtract` 字段 + confidence；confidence 低于阈值 → 状态机强制转 `pending_review`；**截止日期必须人工复核后才可 published**（代码层：published 前置校验 `deadlineVerifiedByHuman === true`）。
4. **可溯源硬校验**：`sourceUrl || sourceChannel` 缺失的记录无法进入 published（数据层 + 服务层双重校验）。
5. **幂等与去重**：`contentHash = sha256(normalized(title) + '|' + normalized(sourceChannel))` 截断 128 位；爬虫与投稿重复提交返回既有条目而非报错。【2026-10-31 整改】原为 32 位 FNV-1a，实测穷举 692,579 个标题即碰撞（不同信息被误判重复而丢弃），已换 SHA-256；**算法变更后存量 contentHash 失效，需重算**。
6. **密钥安全**：LLM key、爬虫配置走 `.env.local`（gitignore）+ 云开发环境变量；**禁止任何密钥入库入 Git**；发现提交了密钥立即轮换并记入第 10 节。
7. **错误处理与日志**：云函数统一返回 `{code, message, data}`；关键操作（审核、发布、爬取、推送）结构化日志；失败可重试（定时任务幂等）。
8. **测试底线**：`shared/domain` 纯函数（状态机、去重、deadline 解析、提醒时间计算、AI 结果校验）**必须有 Vitest 单测**；云函数至少冒烟测试；UI 不强制 E2E（单兵产能现实约束）。
9. **依赖克制**：新增依赖须在提交信息中说明理由；禁止引入与 MVP 功能无关的框架/库（第一性原理：每份依赖都是长期维护成本）。
10. **性能与成本现实**：云函数注意冷启动与超时（爬取/LLM 调用走异步任务 + 轮询/回调，不做同步长等待）；LLM 调用控制单条 token 量（只送必要原文字段）。

---

## 5. MVP 功能 ↔ 开发顺序映射（依据 spec v1.0 第 2 节）

| 里程碑 | 内容（spec 编号） | 验收要点 |
|---|---|---|
| M1 骨架与信息流 | 云开发初始化、shared 类型/schema、录入后台（B3）、信息流 + 分类频道（A1/A2） | 后台录入一条带来源的信息，小程序可见 |
| M2 采集与结构化管线 | AI 结构化（B4）、审核状态机、官网定时爬取（B2）、众包投稿（B5） | 投稿→AI 预审→人工确认→发布全链路跑通；重复投稿被去重 |
| M3 账号与提醒 | 微信授权登录（C1/D0）、Deadline 日历 + 订阅消息提醒（A3） | 订阅授权余量被记录；deadline 未人工复核不可发布 |
| M4 路线图与公众号监控 | 简版路线图（A4，人工整理 + lastMaintainedAt）、`tools/` 公众号半自动监控（B1） | 路线图节点关联实时信息；监控产物可一键导入后台 |
| M5 验证就绪 | 指标埋点（周活、订阅率/打开率、投稿数、纠错率）、发布准备 | 指标可从后台数据看板读出（对应 spec 第 6 节验证指标） |

**范围红线（单兵产能，R2/R7）**：MVP 只做 P0（竞赛 + 就业实习），保研走公开政策兜底；V1/远期功能（A5-A7、D1-D3、C2/C3、B6/B7、E1/E2 等）**禁止提前开发**，除非 spec 文档先行变更。

---

## 6. 风险 → 工程应对映射（spec 第 5 节）

| 风险 | 工程落点 |
|---|---|
| R9 公众号灰色方案合规/稳定性【客观事实：微信不开放读取能力】 | 监控代码隔离在 `tools/`（本机运行，可整体下线不影响主链路）；多方案冗余设计；人工补录后台始终可用（降级可运行） |
| R10 官网爬取反爬/改版 | 爬虫低频（定时触发器每日/每小时级）；解析失败进 `source.reliability` 留痕并告警到后台；人工补录兜底 |
| R11 订阅消息触达率【客观事实：一次性授权】 | `subscribe_record` 记录授权余量；推送失败不静默——进后台看板；架构预留 C2/C3 触达通道接口（但 V1 前不实现） |
| R12 AI 字段提取错误 | 见第 4 节第 3 条：confidence 分流 + 截止日期人工复核硬校验 + 纠错通道（corrected 状态 + review_log） |
| R8 路线图过期 | `roadmap_node.lastMaintainedAt` 必填 + 后台「待维护节点」视图 |

---

## 7. 产品原则 → 代码规则对照

| 产品原则（spec 第 3 节） | 代码规则 |
|---|---|
| 不做无来源信息 | source 字段双层校验，见 4.4 |
| 截止时间是第一公民 | deadline 独立建模 + 精度区分 + 提醒链路优先 + 人工复核硬校验 |
| 信息质量 > 信息数量 | AI 不直发、去重优先、纠错留痕 |
| 中台优先不是社区 | 不建评论/关注/动态（E1/E2 远期） |
| 成长视角 | roadmap_node 与 information 双向关联（节点可挂实时信息） |

---

## 8. 操作规范（每次开发必执行）

### 8.1 单次开发工作流

1. **开工**：重读本文件第 2/4/5 节 → 明确本次任务对应 **spec 功能编号**（如 A3/B4）→ 若需求超出第 5 节范围红线，先停下向用户确认并更新 spec。
2. **计划**：拆小步（一步 = 一次可验证的提交）；先改 `shared/` 类型与 schema，再写业务，最后接 UI。
3. **编码**：遵守第 4 节全部底线；只做本步所需，不顺手重构无关代码。
4. **验证**：`tsc --strict` 通过 + ESLint 通过 + 相关 Vitest 通过；云函数改动跑冒烟；小程序改动在开发者工具自查主流程。
5. **提交**：Conventional Commits：`feat(miniprogram): 增加截止日历视图`；一次提交一个逻辑变更；禁止提交密钥/临时文件。
6. **收尾**：自检清单（见 8.2）→ 若本次有犯错/返工，按第 9 节记录 → 若决策改变本文件内容，更新变更记录。

### 8.2 自检清单（每次提交前）

- [ ] 本次改动对应 spec 编号明确，未越范围红线
- [ ] 新增写操作过 zod 校验；类型来自 `shared/`
- [ ] 基础类型（IsoDateTime/IsoDate/DeadlineInfo/SourceType/ApiResult）只从 `shared/types/common` 导入，不从相邻类型文件导入（E-001/E-005 两次复发后升级）
- [ ] 无 AI 直发路径；deadline 类信息有 `deadlineVerifiedByHuman` 校验
- [ ] 来源字段（sourceUrl/sourceChannel）强制存在
- [ ] 时间字段 ISO 8601，无本地化字符串
- [ ] 无密钥入库入 Git
- [ ] `shared/domain` 改动有对应单测更新
- [ ] tsc / eslint / vitest 通过

### 8.3 协作与沟通规范

- 回答实事求是：**不确定的标注【假设】，外部约束标注【客观事实】**，不猜测、不夸大进度。
- 出现错误/返工/决策失误：**立即**如实记录第 10 节，不掩饰；根因分析到「为什么会发生」而非「表面现象」。
- 需求变更：产品结论类变更先改 `spec/`，实现约束类变更改本文件；两边不一致时以「先改哪边」的提交记录为准追溯。

---

## 9. AGENT.md 自身维护规则

- **每次开发前**：读第 2/4/5/8 节；**每次新修改（新一轮开发）前**：先读第 10 节错误记录，同类错误第 2 次出现必须把对策升级为第 8.2 节自检清单的强制检查项。
- **每次开发后**：有新决策/新技术约束 → 更新对应章节并在第 11 节登记；有犯错 → 更新第 10 节。
- 本文件是唯一规范来源：**其他地方出现与本文件矛盾的开发约定时，以本文件为准**（发现矛盾应修正并登记）。
- 只保留仍然成立的内容：过期结论应改写或删除（如某决策被推翻，写明推翻原因，不留死条目）。

---

## 10. 错误与教训记录（每次犯错后归纳写入）

> 规则：① 当次开发中发生错误/返工/决策失误 → 当场新增一行（如实、客观、写根因）；② 每轮新修改开始前回顾全表；③ 同类错误第 2 次出现 → 对策升级进 8.2 自检清单，并在「升级状态」列标注；④ 定期归纳合并同类项（保留根因共性，删冗余细节）。

| 编号 | 日期 | 错误/返工/失误 | 根因 | 纠正与预防措施 | 影响范围 | 升级状态 |
|---|---|---|---|---|---|---|
| E-001 | 2026-10-28 | shared/types/roadmap.ts 从 information.ts 导入 IsoDateTime，但该类型定义在 common.ts 且未再导出，tsc 报 TS2459 后返工 | 基础类型归属不统一：部分基础类型定义在 common.ts，写新文件时凭印象从相邻文件导入 | 约定：基础类型（IsoDateTime/IsoDate/DeadlineInfo/SourceType/ApiResult）只定义于 common.ts，其他文件一律从 common 导入；写完 shared 文件先跑 tsc 再进入下一步 | shared/types/roadmap.ts | 已升级（2026-10-31 E-005 同类复发，对策升级至 8.2 自检清单） |
| E-002 | 2026-10-28 | 后台 admin 交给子 agent 开发，agent 报「完成」但 code/admin/ 目录不存在、无任何产出，只能重做 | 对子 agent 的完成汇报缺乏落盘核验就视为交付；agent 异常终止时未产出文件 | 约定：子 agent 交付的代码必须以「文件存在 + 构建/测试通过」核验为准，汇报文字不作为交付依据；异常终止的 agent 任务重做而非续接假设 | admin/（返工一次） | 未升级（首次） |
| E-003 | 2026-10-28 | 与子 agent 的 npm install 并行时，本侧 npm install / npx tsc / npx vitest 连续假死 630s 超时（3 次），命令实际未执行 | npm/npx 阻塞（机制未完全锁定）：全部假死均发生在并发 npm 操作期间；子 agent 另实测发现本机全局 npmrc 的 cache 目录不可写会导致 npm 挂起（其以 `npm --cache <可写目录>` 绕过）。两者可能叠加 | 约定：①验证优先用 `node node_modules\typescript\bin\tsc`、`node node_modules\vitest\vitest.mjs`、`node scripts/*.mjs` 直调，绕过 npx；②npm install 错峰执行，必要时加 `--cache` 指定可写缓存目录 | 云函数构建与单测验证环节 | 未升级（首次） |
| E-004 | 2026-10-30 | M3 首次向小程序引入 shared/ 值导入（deadline 纯函数、常量）后 H5 预览编译失败（Module parse failed），修复返工两次：先加顶层 `compile.include` 无效，再试 webpackChain 修改 rule('script').include 仍无效，最终平台级 `mini.compile/h5.compile` + 修正 sharedDir 路径后编译通过 | 三层根因：① shared 此前只被 `import type` 引用（编译期擦除），值代码从未进过 Taro 转译范围，未提前验证；② Taro runner 从平台级 config 读 `compile`（顶层 `compile` 不在 config 合并白名单），webpackChain 改 rule include 也不生效；③ 最隐蔽：sharedDir 算成 `path.resolve(__dirname,'..','shared')` = miniprogram/shared（不存在，shared 实为 miniprogram 兄弟目录），少一级导致 include 永远匹配不到，前两次修复均被此掩盖 | 最终方案：`compile.include: [path.resolve(__dirname,'..','..','shared')]` 放 `mini` 与 `h5` 平台级配置；约定 shared 新增值（非类型）导入后必须过一次 H5 构建验证；include/exclude 路径先核对真实存在再配 | miniprogram/config/index.ts | 未升级（首次） |
| E-005 | 2026-10-31 | admin ImportMonitor.vue 从 types/information 导入 SourceType，但该类型定义在 common.ts，vue-tsc 报 TS2459 后返工 | 与 E-001 同类：基础类型归属不统一，写导入时凭印象从相邻类型文件导入（information.ts 内部自用 SourceType 但未再导出） | 修正为从 types/common 导入；因同类错误第 2 次出现，按规则③将对策升级进 8.2 自检清单（基础类型只从 common 导入） | admin/src/views/ImportMonitor.vue | 已升级（对策进 8.2 自检清单） |

---

## 11. 变更记录（本文件）

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-28 | 首版：技术栈决策（原生小程序 + 云开发 + Vue3 后台）、架构与数据模型、10 条代码底线、MVP 里程碑映射、风险工程应对、操作规范与错误记录机制 | 基于 spec v1.0 进入开发阶段，确定开发总规范 |
| 2026-10-28 | 小程序端由「原生小程序」推翻为「Taro 4.1.9 + React」，推翻原因记入 2.2；新增 2.3 Taro 开发要点；目录结构中 miniprogram/ 定义为 Taro 项目根 | 用户指定使用 miniapp-builder 插件开发，其工具链仅支持 Taro 项目（用户已确认） |
| 2026-10-30 | M3 落地：user / subscribe_record / push_fail / reminder_log 类型与 zod schema、api-user（登录/资料/订阅授权余量）、job-remind（每时定时推送 + reminder_log 幂等 + 失败进 push_fail 看板）、api-info 增 info.deadlines、小程序 Deadline 日历页 + tabBar + 订阅授权入口；shared/constants 新增 REMIND_TEMPLATE_ID（环境变量可覆盖）；miniprogram config 平台级（mini/h5）增 `compile.include` 纳入 ../shared 使 shared 值代码可打包（根因与返工见 E-004）；api-info 返回补 `_id→id` 映射 | M3（C1/D0/A3/R11）按里程碑推进；【客观事实】订阅消息模板 ID 须在微信公众平台配置后回填占位常量或环境变量；Taro 4.1.9 requestSubscribeMessage 类型（tmplIds/entityIds 均标必填）与 weapp 运行时契约不一致，代码按运行时契约断言并留注 |
| 2026-10-31 | M4 落地：shared 增 roadmapNodeCreate/UpdateSchema + domain/roadmap（isNodeStale/filterStaleNodes/groupNodesByYearSemester，R8 阈值 180 天【假设】需运营校准）；api-info 增 roadmap.list（节点内嵌已发布关联信息，排序走 shared 分组函数）；api-admin 增 roadmap.create/update/listAdmin（内容字段变更自动刷新 lastMaintainedAt）+ info.import（B1 一键导入，逐条 zod 校验 + contentHash 去重，强制 deadlineVerifiedByHuman=false）；小程序「路线图」tab 页（A4）；tools/mp-monitor 本机半自动监控 CLI（fetch/add 双通道，零依赖，产物 JSON 供后台导入）；admin 增「路线图维护」（待维护节点视图）与「监控产物导入」视图 | M4（A4/B1/R8/R9）按里程碑推进；【客观事实】微信不开放公众号读取能力，B1 只能半自动（人工确认后入库），工具整体可下线不影响主链路（R9 三通道降级）；【假设】公众号文章页解析启发式（og:title/js_content/var ct）未经真实页面验证，失效走 add 通道或后台人工补录 |
| 2026-10-31 | M5 落地（MVP 里程碑全部完成）：shared 增 metrics 类型 + domain/metrics（buildMetricsSnapshot/safeRate，KPI 口径唯一定义）+ trackEventSchema；api-user 增 track.activity（每日活跃幂等）/track.event（订阅回流打开）；api-admin 增 metrics.dashboard（周活/订阅率/打开率/投稿数/纠错率聚合）；job-remind 推送 page 带 from=remind&infoId 归因；小程序启动埋点 + 日历页打开埋点（fire-and-forget 不阻塞主链路）；admin 增「数据看板」视图。验证含 weapp 生产构建通过（taro build --type weapp 52.98s，此前 M3 观察到的 Node 24 prebundle 崩溃未复现） | M5（指标埋点 + 发布准备）对应 spec 第 6 节验证指标；【假设】KPI 口径（周活=近 7 天不同 openId、订阅率=可触达/周活、打开率=回流打开/推送成功、纠错率=corrected/published 动作比）为工程预设需试点确认；分母 0 返回 null 看板显示「—」 |
| 2026-10-31 | **代码审查 + TDD 测试整改**（依据 make/test/ 审查报告，高危+中危全改）：①§4.5 contentHash 由 32 位 FNV-1a 改为 SHA-256 截断 128 位（原哈希实测碰撞，存量需重算）；②§3.3 来源要求由「两者必填」收敛为「至少一个」，消除与 §4.4 的矛盾；③shared 新增 domain/date（真实日历校验 + 东八区口径唯一实现）与 domain/sha256（纯实现，不引 node:crypto 以免小程序构建失败）、domain/ai-extract（AI 结果校验收口，补上 §4.8 点名的纯函数）；④写入侧强制 deadlineVerifiedByHuman=false，仅 info.review 可置 true（R12 落实到代码层）；⑤info.update 补 zod 校验 + 来源门禁 + 改期即失效复核标记；⑥job-remind 授权余量循环内递减（原会超发）+ 提醒去重改为按 infoId 预取；⑦日期口径统一走 shared/domain/date，消除 UTC 与东八区混用 | 依据代码审查结论整改；涉及存量数据迁移（contentHash 重算）与行为变更（写入侧不再接受自报的 deadlineVerifiedByHuman、投稿 reject 状态值由 'reject' 更正为 'rejected'），下游若有依赖需同步 |
