# 同频课表

> 面向实验室成员的中文课表协作系统：集中维护个人课表，快速查看成员安排，并找出真正可用的共同空闲时间。

![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Stage](https://img.shields.io/badge/Stage-MVP--B-2F6B57)

同频课表解决的不是“画一张课表”，而是实验室里反复出现的协作问题：谁今天没课、几个人什么时候同时有空、课程是否撞时间、整张课表怎样安全导入，以及导入前后发生了什么变化。

## 项目亮点

- **以成员协作为中心**：所有登录成员都能查看启用成员的课表，无需在群里逐个询问。
- **所有权由服务端决定**：课程写入只认当前会话，不接受客户端指定 `student_id`，成员不能修改他人课表。
- **按真实教学规则计算**：周次落库为具体数组，单双周、节次冲突、连续空闲和学期边界都有明确规则。
- **多维空闲检索**：支持个人空闲、多人共同空闲、指定时间段、全天无课、星期、年级、连续节数和最短分钟数。
- **导入前先预览**：标准 Excel / CSV 文件先做格式、重复、冲突和差异检查，确认后才替换本人当前学期课表。
- **操作可追踪**：网页课程 CRUD 写入审计日志；整表导入额外生成只读课表版本和完整快照。
- **适合小团队自托管**：提供 PostgreSQL、应用和 Caddy 的 Docker Compose 编排，默认通过 HTTPS 对外服务。

## 当前能力

| 模块 | 已实现能力 |
| --- | --- |
| 身份与注册 | 学号登录；姓名与学号必须匹配预置名册；无管理员角色，成员权限平等 |
| 我的课表 | 按周查看；点击空白节次添加；编辑、删除本人课程；冲突和重复检查 |
| 成员课表 | 搜索成员；按年级筛选；查看任意启用成员的指定周课表 |
| 空闲查询 | 单人空闲、多人交集、连续节次、最短分钟数、日期范围、星期和时间段筛选 |
| 课表导入 | 下载标准 Excel / CSV 模板；最大 2 MB；逐行校验；差异预览；确认后整表替换 |
| 历史记录 | 每次确认导入生成 `ScheduleVersion` 与完整课程快照；当前只读，不提供回退 |
| 注册进度 | 所有登录成员可查看总人数、已注册、未注册与待补学号名单 |
| 运维 | 数据库迁移、初始化数据、健康检查、备份与显式确认恢复脚本 |

## 使用流程

```mermaid
flowchart LR
    A[名册中的成员] --> B[姓名 + 学号注册]
    B --> C[学号登录]
    C --> D{维护课表}
    D --> E[网页逐条增删改]
    D --> F[Excel / CSV 预览导入]
    E --> G[课程与审计日志]
    F --> H[差异、冲突与错误检查]
    H -->|确认| I[替换本人课表]
    I --> J[版本与完整快照]
    G --> K[成员课表 / 共同空闲]
    J --> K
```

## 技术架构

```mermaid
flowchart LR
    Browser[浏览器] -->|HTTPS| Caddy[Caddy]
    Caddy --> Next[Next.js App Router]
    Next --> Auth[Better Auth]
    Next --> API[Route Handlers + Zod]
    API --> Service[业务服务层]
    Service --> Drizzle[Drizzle ORM]
    Drizzle --> Postgres[(PostgreSQL)]
```

| 领域 | 技术 |
| --- | --- |
| Web | Next.js App Router、React、TypeScript |
| UI | Tailwind CSS、Lucide React、中文响应式界面 |
| 认证 | Better Auth，学号作为 username |
| 数据 | PostgreSQL 17、Drizzle ORM、Drizzle Kit |
| 校验与导入 | Zod、ExcelJS、CSV 解析 |
| 部署 | Docker Compose、Caddy 自动 HTTPS |
| 测试 | Node Test Runner、tsx、数据库集成测试 |

请求链路遵循：**会话确认身份 → Zod 校验 → 服务层业务规则与短事务 → Drizzle / PostgreSQL → 中文错误反馈**。页面层不直接访问数据库，外部网络调用不进入数据库事务。

## 快速开始

### 方式一：本地开发

前置条件：Node.js 24、npm，以及一个可访问的 PostgreSQL 数据库。

```powershell
cd web
Copy-Item .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

开始前请编辑 `web/.env`：

```dotenv
DATABASE_URL=postgresql://schedule:你的密码@localhost:5432/schedule
BETTER_AUTH_SECRET=至少32位的随机字符串
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

然后访问 [http://localhost:3000](http://localhost:3000)。首次注册前，需要先把允许注册的成员姓名与学号写入 `students` 名册表。

### 方式二：Docker Compose 部署

```bash
cd web
cp .env.production.example .env
# 编辑 .env，填写域名、数据库密码和 Better Auth 密钥
docker compose up -d --build
docker compose ps
```

Compose 会依次启动 PostgreSQL、执行迁移与初始化，再启动 Next.js 和 Caddy。正式环境只应开放 `80/443`；PostgreSQL 仅绑定服务器本机的 `127.0.0.1:5433`，不要暴露到公网。

完整上线、备份和恢复步骤见 [部署与运维文档](docs/04-DEPLOYMENT.md)。

## 常用命令

以下命令均在 `web/` 目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run lint` | 运行 ESLint |
| `npm test` | 运行业务规则单元测试 |
| `npm run test:integration` | 运行权限与数据库集成测试 |
| `npm run build` | 执行 TypeScript 检查和生产构建 |
| `npm run db:generate` | 根据 schema 生成迁移 |
| `npm run db:migrate` | 执行数据库迁移 |
| `npm run db:seed` | 初始化当前学期与节次 |
| `npm run db:studio` | 打开 Drizzle Studio |

## 项目结构

```text
.
├─ docs/                       产品、数据库、API、架构与部署文档
├─ web/
│  ├─ src/app/                页面与 Route Handlers
│  ├─ src/components/         课表、表单和布局组件
│  ├─ src/lib/                业务规则、服务与单元测试
│  ├─ src/db/                 Drizzle schema 与数据库连接
│  ├─ test/                   权限和未登录访问集成测试
│  ├─ drizzle/                SQL 迁移与 schema 快照
│  ├─ scripts/                初始化、测试成员、备份与恢复脚本
│  ├─ compose.yaml            app + postgres + caddy 编排
│  └─ Dockerfile
└─ AGENTS.md                  当前开发阶段与不可偏离规则
```

## 关键业务规则

1. 登录成员可以查看所有启用成员的课表，但只能写自己的课程。
2. 服务端从会话确定课程所有者，禁止信任请求体或上传文件中的成员标识。
3. 自助注册必须匹配未绑定账号的预置名册项。
4. 周次写入前展开为具体 `smallint[]`；冲突要求星期相同、周次相交且节次重叠。
5. 共同空闲是有效节次全集减去所有所选成员占用节次的并集；连续空闲不能跨占用节次拼接。
6. 网页单条 CRUD 只写审计日志；只有确认整表导入才创建版本与完整快照。

更完整的验收口径见 [产品需求文档](docs/01-PRD.md)。

## 安全与数据边界

- `.env`、数据库连接串、认证密钥、备份文件和构建产物不得提交到 Git。
- 生产环境必须使用不同的强随机值配置 `POSTGRES_PASSWORD` 与 `BETTER_AUTH_SECRET`。
- 不在客户端包、日志、截图或 Issue 中暴露真实姓名、学号、课表和访问凭据。
- 部署或公开仓库前，应审查非默认 seed 脚本和测试数据，确认其中不含真实个人信息。
- 恢复数据库必须使用显式确认变量；不要执行会删除数据卷的 `docker compose down -v`。

## 当前阶段与边界

当前实现范围为 **MVP-B**。以下能力暂不包含在本阶段：

- 教务系统专用格式或登录同步；
- 课程表图片识别；
- 历史版本回退；
- 匿名公开课表；
- 调休、停课、补课等日期例外；
- 消息与日程通知；
- 管理员角色和网页名册管理。

标准 Excel / CSV 导入不等同于任意教务系统文件解析；历史版本页面也只是只读快照，不应描述为可恢复备份。

## 文档导航

- [产品需求与业务规则](docs/01-PRD.md)
- [数据库设计](docs/02-DATABASE.md)
- [API 设计](docs/03-API.md)
- [部署与运维](docs/04-DEPLOYMENT.md)
- [系统架构](docs/05-ARCHITECTURE.md)
- [ER 图](docs/06-ER_DIAGRAM.md)
- [开发任务清单](docs/07-TASKS.md)

---

如果你也在为实验室、课题组或小团队协调共同时间，可以从业务规则和部署文档开始了解项目。请在提交改动前至少运行 `npm run lint`、`npm test` 和 `npm run build`。
