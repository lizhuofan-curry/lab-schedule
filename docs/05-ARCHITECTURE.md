# 系统架构（MVP-A）

版本：1.0
状态：开发基线
日期：2026-09-27

本文描述「同频课表」MVP-A 的整体结构、分层、目录组织与一次请求的完整链路，供新开发者快速建立全局认识。需求见 [01-PRD.md](01-PRD.md)，数据模型见 [02-DATABASE.md](02-DATABASE.md) 与 [06-ER_DIAGRAM.md](06-ER_DIAGRAM.md)，接口契约见 [03-API.md](03-API.md)。

## 1. 分层架构

```text
┌────────────────┐
│  浏览器（用户） │  登录成员 / 匿名（匿名仅登录、注册页）
└───────┬────────┘
        │ HTTPS (443)
┌───────▼────────┐
│     Caddy      │  反向代理 + 自动 HTTPS；仅暴露 80/443，5432 不映射公网
└───────┬────────┘
        │ 内部网络
┌───────▼─────────────────────────┐
│      Next.js 应用容器            │
│  ┌──────────────────────────┐   │
│  │ App Router 页面层        │   │  app/**/page.tsx、*-view.tsx、components/
│  └────────────┬─────────────┘   │
│  ┌────────────▼─────────────┐   │
│  │ Route Handler 接口层     │   │  app/api/**/route.ts（HTTP 契约）
│  └────────────┬─────────────┘   │
│  ┌────────────▼─────────────┐   │
│  │ Service 业务层           │   │  lib/*-service.ts（规则、事务、审计）
│  └────────────┬─────────────┘   │
│  ┌────────────▼─────────────┐   │
│  │ Drizzle ORM 数据层       │   │  db/schema.ts、db/index.ts
│  └────────────┬─────────────┘   │
└───────────────┼─────────────────┘
                │ 内部 TCP 5432
┌───────────────▼─────────────────┐
│           PostgreSQL            │
└─────────────────────────────────┘
```

- **页面层**只负责渲染与交互，不直接访问数据库。
- **接口层**只做会话解析、Zod 入参校验、调用服务层、映射错误码与状态码。
- **业务层**承载全部业务规则（冲突、周次标准化、审计、权限），是唯一允许开启事务的地方。
- **数据层**只包含 schema 定义与连接，不含业务逻辑。

## 2. 技术栈

| 关注点 | 选型 |
| --- | --- |
| 前端框架 | Next.js App Router + React |
| 语言 | TypeScript |
| 样式 | Tailwind CSS |
| 认证 | Better Auth（学号 = username，内部合成邮箱，不展示） |
| 数据库 | PostgreSQL |
| ORM / 迁移 | Drizzle ORM + drizzle-kit |
| 校验 | Zod |
| 部署 | Docker Compose（app + postgres + caddy） |

## 3. 目录组织

```text
web/
├─ src/
│  ├─ app/                    页面与接口（App Router）
│  │  ├─ layout.tsx / page.tsx / globals.css
│  │  ├─ login/ register/ dashboard/ members/ groups/
│  │  ├─ my-schedule/ availability/ registration/
│  │  └─ api/
│  │     ├─ auth/[...all]/route.ts         Better Auth 认证入口
│  │     ├─ my/courses/route.ts            本人课程列表 / 新增
│  │     ├─ my/courses/[id]/route.ts       本人课程修改 / 删除
│  │     ├─ students/route.ts              成员搜索
│  │     ├─ students/[id]/schedule/route.ts 查看他人课表
│  │     ├─ availability/query/route.ts    空闲查询
│  │     ├─ groups/**/route.ts             小组目录、组员和组长维护
│  │     ├─ registration-stats/route.ts    注册统计
│  │     └─ health/route.ts                健康检查
│  ├─ components/             复用组件（app-shell、schedule-board、course-dialog、week-switcher、empty-state）
│  ├─ db/                     schema.ts（表定义）、index.ts（连接）
│  ├─ lib/                    服务与领域逻辑（见下）
│  └─ proxy.ts
├─ test/                     权限集成测试（连独立 schedule_test 库，tsx + @/ 别名）
├─ drizzle/                   Drizzle 迁移产物
├─ scripts/                   seed-initial-data.mjs（初始化学期/节次，可选导入已有成员）
├─ Dockerfile / Caddyfile / compose.yaml
└─ package.json / drizzle.config.ts / …
```

`lib/` 内的职责划分：

| 文件 | 职责 |
| --- | --- |
| `auth.ts` / `auth-client.ts` | 服务端与客户端的 Better Auth 实例 |
| `server-auth.ts` | `getCurrentMember()`：从会话解析本人 `studentId`；`unauthorized` / `forbidden` 统一响应 |
| `course-schema.ts` | 课程写接口的 Zod 校验与周次标准化输入 |
| `course-rules.ts` | BR-05 冲突判定、BR-04 周次去重排序（纯函数，供 service 复用） |
| `course-service.ts` | 课程增删改：学期/节次配置校验、冲突检测、审计写入 |
| `schedule-service.ts` / `schedule-types.ts` | 周课表查询与类型 |
| `availability-service.ts` / `availability-types.ts` | 空闲 / 共同空闲 / 连续节次计算与类型 |
| `registration-service.ts` / `registration-summary.ts` | 开放注册后的成员绑定与注册统计 |
| `group-schema.ts` / `group-policy.ts` | 小组写入校验与纯权限规则 |
| `group-service.ts` | 小组目录、组长授权、短事务和审计 |

## 4. 一次请求的链路（以「新增课程」为例）

```text
浏览器 POST /api/my/courses
   │ ① 请求体（含 semesterId、weekday、startPeriod、endPeriod、weeks…）
   ▼
Route Handler
   │ ② getCurrentMember()：由会话解析本人 userId + studentId（不信任请求里的 student_id）
   │ ③ Zod 校验请求体；失败返回 422 + 中文 message
   ▼
course-service.saveCourse()
   │ ④ 校验学期存在、周次 ≤ 学期周数、节次区间在 periods 内
   │ ⑤ 开启事务：查同 student+semester+weekday 下节次重叠且周数组相交的课程
   │ ⑥ 冲突则抛 CourseConflictError（BR-05）；否则写入 courses
   │ ⑦ 同一事务内写入 audit_logs（BR-11）
   ▼
Drizzle ORM ──► PostgreSQL
   │ ⑧ 提交事务，返回新课程
   ▼
Route Handler 返回 200 + 新课程 JSON
```

写接口统一遵循：会话确定所有者 → Zod 校验 → 服务层事务（校验 + 写入 + 审计）→ 错误码映射。

## 5. 横切关注点

### 5.1 认证与授权

- 匿名只可访问登录/注册；其余接口由 `getCurrentMember()` 返回 `null` 时统一 `401`。
- 所有权判断只依据会话解析出的 `studentId`，写接口不接受也不使用请求中的 `student_id`（见 [03-API.md](03-API.md)）。
- 系统无管理员角色，所有注册成员权限平等（BR-03）。
- 小组写操作是资源角色授权：任意成员可创建，只有该组当前 `leader` 可改名、维护成员、转让或解散；这不是全局管理员角色（BR-20）。

### 5.2 事务与审计

- 冲突校验与写入必须在同一短事务内完成，避免并发穿透（[02-DATABASE.md](02-DATABASE.md) 第 3 节）。
- 事务保持短小，外部网络调用不放进事务。
- 网页课程 CRUD 写 `audit_logs`；MVP-A 不创建 `schedule_versions`（BR-11）。

### 5.3 错误码

接口层把服务层抛出的业务错误映射为 `03-API.md` 第 6 节定义的错误码（`COURSE_CONFLICT`、`DUPLICATE_COURSE`、`FORBIDDEN_OWNER`、`OUTSIDE_SEMESTER` 等），前端据此展示可操作的中文提示。

### 5.4 配置与密钥

数据库连接串、Better Auth 密钥、域名等只存在于 `.env`，不进入 Git、日志、客户端包或截图（[04-DEPLOYMENT.md](04-DEPLOYMENT.md)）。

### 5.5 测试

- **纯函数单测**（`npm test`）：`src/lib/*.test.ts`，Node 内置 `node --test`；覆盖周次标准化、冲突规则、写接口校验、空闲与注册统计等。
- **权限集成测试**（`npm run test:integration`）：`test/*.test.mts`，`tsx` 解析 `@/` 别名并加载 `server-only`（`--conditions react-server`），连接独立 `schedule_test` 库（db 通过 `127.0.0.1:5433` loopback 映射）；覆盖 A 查看 B、A 不能改/删 B、未登录返回 401。
- **性能基线**（`npm run test:performance`）：在独立 `schedule_test` 库生成 100 名成员、每人 100 门课程，测量成员目录、单人课表、课表总览和 10/100 人共同空闲；运行前后均清理测试数据，固定阈值用于发现明显性能倒退。
