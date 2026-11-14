# 大学生信息数据中台（MVP）

面向单校试点的校园信息聚合中台：把分散在教务处、就业处、学院、学生组织等渠道的通知，聚合为**结构化、可溯源、带截止提醒**的统一入口。由微信小程序端、录入/审核后台、采集与结构化管线三部分组成。

## 项目状态

| 项 | 当前事实 |
|---|---|
| 阶段 | MVP 里程碑 M1–M5 已完成（信息流 → 采集/结构化 → 账号与提醒 → 路线图 → 指标埋点） |
| 自动化测试 | 23 个测试文件 / 340 个 Vitest 用例，最近一次本地运行（2026-11-14）全部通过 |
| 覆盖范围 | 仅 P0（竞赛 + 就业实习）；P1/远期功能未开发，详见 `spec/01_产品思考文档_v1.0.md` |
| 未包含 | 生产环境配置、微信 AppID / 云环境 ID、订阅消息模板 ID、LLM 密钥 |

## 解决的问题

校园信息「分散、过载、易错过」：信息源多且渠道不统一，学生需盯十几个入口；同时错误或过期信息的信任代价极高。因此工程上优先保证**信息质量 > 信息数量**，并把**截止时间**作为一等公民建模。

## 架构

```
[信息源]  学校官网（定时爬取）        ─┐
          公众号（本机半自动 + 人工确认）┼→ 采集/投稿入口 → AI 结构化（OpenAI 兼容接口）
          用户投稿（小程序）          ─┘                        │
                                                                 ▼
                                              审核状态机（AI 预审 + 人工复核）
                                                                 │
                                                                 ▼
                                             云数据库 information（仅 published 可见）
                                                │                    │
                                     小程序信息流/分类频道      截止日历 + 订阅消息
                                                │
                                          简版成长路线图
```

7 个云函数（按领域拆分，内部薄路由、单函数多 action）：

| 云函数 | 职责 |
|---|---|
| `api-info` | 公开只读：信息流、分类频道、详情、路线图 |
| `api-submission` | 投稿提交、我的投稿、AI 预审流转 |
| `api-admin` | 后台：录入、审核、发布、路线图维护、监控产物导入、数据看板 |
| `api-user` | 登录、资料、订阅授权余量、埋点 |
| `job-crawl` | 官网公告定时爬取（每小时） |
| `job-ai-extract` | AI 结构化抽取 |
| `job-remind` | 截止提醒推送（每小时窗口判定 + 幂等留痕） |

## 目录结构

```
trae/
├── spec/                      # 产品文档：产品思考文档 v0.1 → v1.0、目录总文件
├── make/
│   ├── code/                  # 工程代码
│   │   ├── AGENT.md           # 开发总规范（唯一规范来源，改动前必读）
│   │   ├── shared/            # 共享层：类型 / zod schema / 领域纯函数（三方共用）
│   │   ├── cloudfunctions/    # 7 个云函数（TypeScript 源码）
│   │   ├── miniprogram/       # Taro 4 + React 小程序端
│   │   ├── admin/             # Vue 3 + Element Plus 管理后台
│   │   ├── tools/mp-monitor/  # 本机半自动公众号监控 CLI（不部署）
│   │   └── scripts/           # 云函数构建脚本
│   └── test/                  # 三轮代码审查与 TDD 测试文档
└── .trae/specs/               # 产品需求初稿（spec 模式产出）
```

## 技术栈

| 层 | 选型 |
|---|---|
| 小程序端 | Taro 4.1.9 + React 18 + TypeScript + Sass（目标平台 weapp） |
| 后端 | 微信云开发 CloudBase：云函数（Node.js 18）+ 云数据库 + 定时触发器 |
| 管理后台 | Vue 3 + Vite + TypeScript + Element Plus |
| AI 结构化 | OpenAI 兼容接口（默认 DeepSeek，baseURL / key 可配置） |
| 共享层 | 纯 TypeScript：类型 + zod 校验 + 领域纯函数 |
| 质量工具 | TypeScript strict、ESLint、Prettier、Vitest |

## 快速开始

前置：Node.js 18+、npm、微信开发者工具（含云开发环境）。

```bash
# 1. 共享层 + 云函数依赖与测试
cd make/code
npm install
npm test                 # vitest run，23 文件 / 340 用例

# 2. 云函数构建（生成各函数根目录 index.js，该产物不入库）
npm run build:cloud

# 3. 小程序端
cd miniprogram
npm install
npm run dev:weapp        # 开发（产物 dist/，用微信开发者工具导入）
npm run build:weapp      # 生产构建

# 4. 管理后台
cd ../admin
npm install
npm run dev              # 本地开发
npm run build            # 类型检查 + 构建
```

云函数部署：先执行 `npm run build:cloud`，再通过微信开发者工具 / CloudBase 上传各函数目录；定时触发器见各函数的 `config.json`。

## 配置项

| 配置 | 位置 | 说明 |
|---|---|---|
| `REMIND_TEMPLATE_ID` | `shared/constants.ts` 或云函数环境变量 | 订阅消息模板 ID，需在微信公众平台选用模板后回填 |
| `VITE_API_BASE` | `admin/.env.development` | 云开发 HTTP API 网关地址，默认占位值 |
| LLM baseURL / key | 云函数环境变量 | 走 OpenAI 兼容协议，密钥不入库、不入 Git |
| 小程序 AppID | `miniprogram/.env.*` 的 `TARO_APP_ID` | 当前为官方占位值 `touristappid` |

真实密钥只允许放在 `.env.local`（已 gitignore）或云开发环境变量中。

## 核心工程约束

以下约束在代码层强制，不依赖约定：

1. **AI 输出不直接发布**：AI 结果仅写入 `aiExtract` 并带 confidence；低于阈值强制转人工复核。
2. **截止时间必须人工复核**：`published` 前置校验 `deadlineVerifiedByHuman === true`。
3. **可溯源**：`sourceUrl || sourceChannel` 至少一个非空，否则无法进入 `published`。
4. **去重**：`contentHash = SHA-256(规范化标题 + '|' + 规范化来源渠道)`，重复投稿返回既有条目而非报错。
5. **时间口径统一**：存储 ISO 8601 + 显式时区，deadline 区分「仅日期 / 含时刻」精度。

完整规范（含错误记录与自检清单）见 [`make/code/AGENT.md`](./make/code/AGENT.md)。

## 已知限制（客观事实）

- 微信不开放公众号内容读取能力，公众号信息只能「半自动采集 + 人工确认」，该链路的监控代码隔离在 `tools/`，整体下线不影响主链路。
- 订阅消息为一次性授权，需按 `subscribe_record` 记录授权余量，触达率受此限制。
- 官网爬取依赖页面结构，改版会导致解析失败；失败进 `source.reliability` 留痕并由后台人工补录兜底。
- 路线图节点需人工维护，`lastMaintainedAt` 超过阈值（默认 180 天）会在后台标记待维护。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`spec/00_目录总文件.md`](./spec/00_目录总文件.md) | 产品文档总入口：五轮问答决策记录 |
| [`spec/01_产品思考文档_v1.0.md`](./spec/01_产品思考文档_v1.0.md) | 功能清单、MVP 范围、12 项风险清单 |
| [`make/code/AGENT.md`](./make/code/AGENT.md) | 开发总规范：技术决策、代码底线、里程碑映射、错误与变更记录 |
| [`make/test/00_总目录文件.md`](./make/test/00_总目录文件.md) | 代码审查与 TDD 测试总入口（缺陷总表 + 测试总览） |
| [`make/test/05_整改报告.md`](./make/test/05_整改报告.md) | 高危 / 中危问题整改明细与验证记录 |

## 许可

本仓库未声明开源许可证，默认保留全部权利。如需引用或复用，请先联系作者。
