# 开发任务清单（MVP-A）

版本：1.0
日期：2026-09-27

本文把 MVP-A 拆分为可执行、可追踪的任务。状态基于 2026-09-27 的代码快照：`[x]` 表示代码已落地，`[ ]` 表示待完成或待验证。「代码落地」不等于「已验证通过」——阶段 4 的验证项必须实际运行确认。

需求边界见 [01-PRD.md](01-PRD.md)；任何超出 MVP-A 的范围（Excel/CSV 导入、ScheduleVersion、回退、匿名公开、日期例外、通知）一律不进入本清单。

## 阶段 0：工程与数据基础

- [x] Next.js App Router + TypeScript + Tailwind 初始化
- [x] Drizzle ORM + drizzle-kit 迁移配置
- [x] 9 张表 schema：认证四表 + students / semesters / periods / courses / audit_logs
- [x] 约束与索引落地（唯一键、CHECK、外键查询索引、weeks GIN）
- [x] 学期与节次种子脚本 `scripts/seed-initial-data.mjs`；成员名册按已确认信息单独导入
- [x] 测试基础设施：`tsx` 解析 `@/` 别名、独立 `schedule_test` 库、`test:integration` 脚本

## 阶段 1：认证与成员名册

- [x] Better Auth：学号 = username，内部合成邮箱，不对外展示
- [x] 注册匹配名册：姓名 + 学号 + 密码；认证唯一约束与名册原子条件更新防止并发重复绑定
- [x] 学号 / 密码登录、登出
- [x] `getCurrentMember()`：服务端从会话解析本人 `studentId`
- [x] 成员搜索（仅公开字段）
- [x] 注册统计与未注册名单（总数、已注册、未注册、待补学号、注册率）

## 阶段 2：课程维护与课表

- [x] 本人课程 CRUD：`POST / PATCH / DELETE /api/my/courses`
- [x] 周次标准化为 `smallint[]`（BR-04）
- [x] 时间冲突检测（BR-05）
- [x] 完全重复拦截（BR-06，返回 `DUPLICATE_COURSE`）
- [x] 所有权校验：写接口不信任请求中的 `student_id`，越权返回 `FORBIDDEN_OWNER` 403（BR-03）
- [x] 课程 CRUD 写 AuditLog（BR-11）
- [x] 查看他人周课表：`GET /api/students/:id/schedule`
- [x] 网格添加 / 编辑 / 删除的响应式 UI

## 阶段 3：空闲查询

- [x] 全天没课成员（BR-09）
- [x] 逐节空闲成员
- [x] 共同空闲：有效节次全集减去占用并集（BR-07）
- [x] 连续 ≥ N 节区间，不跨占用拼接（BR-08）
- [x] 学期边界校验与明确提示（BR-10）

## 阶段 4：验证

按 [AGENTS.md](../AGENTS.md) 的验证要求，每次交付至少执行：

- [x] `npm run lint` 通过
- [x] TypeScript `npx tsc --noEmit --incremental false` 通过
- [ ] 当前代码的 `npm run build` 生产构建待在重建 Docker 镜像时复验（不以 TypeScript 通过替代）
- [x] `npm test` 单元测试通过（课程冲突 BR-05、周次标准化 BR-04、写接口校验等，共 27 个）
- [x] `npm run test:integration` 通过（共 11 个）
- [x] 真实 HTTP 权限测试：通过 Better Auth 注册取得会话 Cookie，覆盖 A 查看 B、A 不能改/删 B、未登录返回 401
- [x] 注册并发测试：同一名册项同时发起两次注册，仅一次成功，且只生成一个账号与一次绑定
- [x] 空闲测试：单双周、非连续空闲、跨学期日期、多人交集
- [ ] 验收重点逐条对照 [01-PRD.md](01-PRD.md) 第 8 节（完整浏览器人工验收待执行）

## 阶段 5：部署与运维

- [x] 本地 `.env` 配置（数据库、Better Auth 密钥和本地地址；不进入 Git）
- [x] 本地 Docker Compose 启动与数据库迁移
- [ ] 腾讯云服务器部署、域名解析与 Caddy HTTPS 证书验证
- [ ] 备份脚本：`pg_dump` 每日备份、保留策略、异地副本
- [ ] 恢复演练：验证用户 / 成员绑定 / 课程 / 学期 / 审计可读，而非仅命令成功
- [ ] 性能基础验证：≥ 100 成员、每人每学期 100 条课程下主要查询流畅

## 明确不做（MVP-A 范围外）

- [ ] Excel/CSV 导入、模板下载、差异预览、整表替换快照（MVP-B）
- [ ] ScheduleVersion 与只读回退（MVP-B）
- [ ] 停课 / 补课 / 调课 / 调休、成员分组、导出、公开分享链接（v1）
- [ ] 课表 OCR、教务系统同步、自动建会、通知、会议室预订（暂不实现）
- [ ] 管理后台与管理员角色（系统设计上不设管理员）
