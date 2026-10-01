<div align="center">

<img src="assets/repository-icon.svg" alt="同频课表 Logo" width="112" />

# 同频课表

### 为实验室、课题组和学生团队找到真正能约在一起的时间

集中维护成员课表，准确处理教学周、单双周与连续节次，并提供成员课表、空闲查询、多人共同空闲和多种安全导入方式。

[在线体验](https://schedule.henubci.cn) · [快速开始](#快速开始) · [部署文档](docs/04-DEPLOYMENT.md) · [产品需求](docs/01-PRD.md) · [API 文档](docs/03-API.md)

[![CI](https://github.com/lizhuofan-curry/lab-schedule/actions/workflows/ci.yml/badge.svg)](https://github.com/lizhuofan-curry/lab-schedule/actions/workflows/ci.yml)
[![Container Delivery](https://github.com/lizhuofan-curry/lab-schedule/actions/workflows/container-delivery.yml/badge.svg)](https://github.com/lizhuofan-curry/lab-schedule/actions/workflows/container-delivery.yml)
[![License](https://img.shields.io/github/license/lizhuofan-curry/lab-schedule)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)

</div>

同频课表解决的不是“把课程画进格子”，而是团队协作中的几个具体问题：某个教学周谁有空、指定时段哪些成员能参加、几个人什么时候同时有空，以及怎样在不覆盖错误数据的前提下导入整张课表。

## 当前状态

| 范围 | 状态 |
| --- | --- |
| MVP-A：注册、登录、课程 CRUD、成员课表、空闲查询 | 已完成并通过浏览器验收 |
| MVP-B：成员筛选、Excel / CSV、复制表格、版本快照 | 已完成并通过浏览器验收 |
| 河大课表同步 | 已使用真实账号完成读取、预览、确认与历史版本验收 |
| v1 图片识别导入 | 本地 OCR 与千问识别均已完成真实图片整链路验收 |
| v1 项目小组 | 基础管理已部署；小组叠加课表已完成本地浏览器验收，待下一次生产部署 |
| 生产部署 | 腾讯云、正式域名、Caddy HTTPS、每日备份、异地副本和隔离恢复已完成 |
| 生产业务验收 | 游客只读权限冒烟已通过；真实成员注册登录后的业务冒烟待完成 |

> “代码实现”“浏览器验收”和“生产部署”在本项目中分别记录，不互相替代。最新验收进度见 [开发任务清单](docs/07-TASKS.md)。

## 核心能力

- **团队课表**：登录成员可查看所有启用成员的课表，并按年级或培养阶段筛选。
- **三类空闲查询**：查看个人空闲、按时间找人、计算多人共同空闲。
- **项目小组**：成员可建立多个协作小组，由组长维护名称与组员；支持一键查询整组共同空闲，并按周查看忙碌强度叠加课表和每节成员明细。
- **真实教学周计算**：周次写入前展开为具体数组，正确处理单双周、节次重叠和非连续空闲。
- **本人数据边界**：成员只能修改自己的课程，所有权始终由服务端会话确定。
- **安全整表导入**：支持标准 Excel / CSV、复制表格、河大同步和课表图片；全部先预览差异，再由本人确认写入。
- **图片草稿**：本地 OCR 或经明确同意的千问视觉模型只生成临时草稿，原图和 OCR 原文不持久化。
- **游客只读**：游客可查看总览、成员课表、项目小组和空闲结果，学号脱敏，不能进入成员专属页面或调用写接口。
- **可追踪变更**：网页单条 CRUD 写入审计日志；确认整表导入时额外创建完整课表快照。

## 导入方式

| 手头资料 | 推荐入口 | 说明 |
| --- | --- | --- |
| 结构化课程数据 | Excel / CSV 模板 | 最稳定，适合批量维护与重复导入 |
| Excel 或教务结果页 | 复制表格 | 保留表头即可解析常见列名与组合时间地点 |
| 河南大学统一认证账号 | 河大课表同步 | 密码仅用于当前请求，且同步学号必须与当前成员一致 |
| 清晰课表截图 | 本地 OCR | 图片留在自托管服务中，必须人工复核 |
| 复杂彩色网格课表 | 千问智能识别 | 发送前明确告知图片去向，结果仍需人工复核 |

所有入口都遵循同一条链路：**读取或识别 → 编辑草稿 → 校验冲突 → 预览差异 → 本人确认 → 写入课表与版本快照**。

## 技术栈

| 领域 | 方案 |
| --- | --- |
| Web | Next.js App Router、React、TypeScript、Tailwind CSS |
| 身份认证 | Better Auth，学号作为 username |
| 数据 | PostgreSQL 17、Drizzle ORM、Zod |
| 导入与识别 | ExcelJS、CSV、Cheerio、Tesseract.js、可选千问视觉模型 |
| 部署 | Docker Compose、Caddy 自动 HTTPS |
| 测试 | Node Test Runner、数据库集成测试、GitHub Actions |

## 快速开始

### 本地开发

需要 Node.js 24 和 PostgreSQL 17。

```bash
cd web
npm ci
cp .env.example .env
# 填写 DATABASE_URL、BETTER_AUTH_SECRET 等服务端配置
npm run db:migrate
npm run db:seed
npm run dev
```

浏览器打开 `http://localhost:3000`。千问视觉识别是可选能力；不配置时，本地 OCR 和其他核心功能仍可使用。

### Docker Compose

```bash
cd web
cp .env.production.example .env
# 填写正式域名、数据库密码和认证密钥
docker compose up -d --build
docker compose ps
```

生产环境只应向公网开放 `80/443`。PostgreSQL 默认绑定服务器本机的 `127.0.0.1:5433`，完整的上线、备份与恢复步骤见 [部署与运维文档](docs/04-DEPLOYMENT.md)。

## 测试与 CI/CD

在 `web/` 目录执行：

```bash
npm run lint
npm test
npm run test:integration
npm run build
```

- `CI` 工作流会在推送和 Pull Request 时运行代码检查、业务规则单元测试、PostgreSQL 集成测试与生产构建。
- `Container Delivery` 工作流会在创建 `v*` 标签或手动触发时构建 Docker 镜像并发布到 GitHub Container Registry。
- 镜像发布属于持续交付，不会自动登录生产服务器或修改生产数据库；正式部署仍按运维文档执行并单独验收。

权限测试重点覆盖 A 查看 B、A 不能修改 B、匿名访问拒绝与游客只读；空闲测试重点覆盖单双周、非连续空闲、跨学期日期与多人交集。

## 关键安全边界

1. 服务端从登录会话确定课程所有者，不信任请求体或导入文件中的 `student_id`。
2. 河大教务密码只用于当前请求，不持久化、不记录日志，外部请求不放进数据库事务。
3. 图片和 OCR 原文不写入数据库；未确认的识别草稿不会改变课表。
4. 游客只有脱敏后的只读权限，不能访问“我的课表”、注册进度和任何写接口。
5. `.env`、数据库连接串、认证密钥、备份文件和真实成员数据不得提交到仓库。

完整规则见 [AGENTS.md](AGENTS.md) 与 [产品需求](docs/01-PRD.md)。

## 项目结构

```text
.
├─ .github/workflows/         CI 与容器交付
├─ assets/                    仓库图标等静态资源
├─ docs/                      PRD、数据库、API、架构与部署文档
├─ web/
│  ├─ src/app/                页面与 Route Handlers
│  ├─ src/components/         课表、表单与布局组件
│  ├─ src/lib/                业务服务、解析器与单元测试
│  ├─ src/db/                 Drizzle schema 与数据库连接
│  ├─ test/                   权限和数据库集成测试
│  ├─ drizzle/                数据库迁移
│  └─ compose.yaml            应用、PostgreSQL 与 Caddy 编排
└─ AGENTS.md                  当前阶段和不可偏离的业务规则
```

## 当前边界

暂未提供其他学校的专用登录同步、历史版本一键回退、调休/停课/补课等日期例外、消息通知和管理员角色。历史版本是用于核对的只读快照，不等同于数据库备份。

## 文档

- [产品需求与业务规则](docs/01-PRD.md)
- [数据库设计](docs/02-DATABASE.md)
- [API 设计](docs/03-API.md)
- [部署与运维](docs/04-DEPLOYMENT.md)
- [系统架构](docs/05-ARCHITECTURE.md)
- [ER 图](docs/06-ER_DIAGRAM.md)
- [开发任务与验收记录](docs/07-TASKS.md)
- [河大教务接口与安全边界](docs/08-河大教务系统接口.md)

## License

本项目采用 [Apache License 2.0](LICENSE)。你可以学习、修改、自托管和再分发本项目；再分发时请保留许可证与版权声明，并遵守许可证中的专利及变更说明条款。
