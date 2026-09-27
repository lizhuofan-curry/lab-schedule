# 数据库设计（MVP-B）

数据库：PostgreSQL。所有时间戳使用 `timestamptz`；单库业务表使用 `bigint generated always as identity` 主键，认证系统保留其文本 ID；周次使用 `smallint[]`，不保存“1-16周”等展示文本。

## 1. 关系概览

```text
User 1 ── 0..1 Student
Student 1 ── * Course
Semester 1 ── * Period
Semester 1 ── * Course
User 1 ── * AuditLog

MVP-B：Student + Semester 1 ── * ScheduleVersion 1 ── * CourseSnapshot
```

河大统一认证密码不建表、不持久化。河大课表确认导入复用 ScheduleVersion，`source` 取 `henu`；文件模板导入则取 `csv` 或 `xlsx`。

## 2. 核心表

### users

Better Auth 管理基础账号字段。系统不设置管理员角色；登录名使用学号，内部合成邮箱仅供认证库兼容，不展示给用户。

### students

| 字段 | 类型 | 约束 |
|---|---|---|
| id | bigint identity | PK |
| name | varchar(50) | not null |
| student_no | varchar(32) | unique, nullable（名单收集中可暂缺；注册前必须补齐） |
| user_id | text | unique, nullable, FK users |
| enabled | boolean | default true |
| created_at | timestamptz | not null |

### semesters

`id`、`name`、`start_date`、`end_date`、`week_count smallint`、`is_current`。只能有一个当前学期；日期范围和周数必须为正。

### periods

`id`、`semester_id`、`period_no smallint`、`name`、`start_time`、`end_time`。唯一约束 `(semester_id, period_no)`，并为外键建立索引。

### courses

`id`、`student_id`、`semester_id`、`name`、`teacher`、`location`、`weekday smallint`、`start_period smallint`、`end_period smallint`、`weeks smallint[]`、`note`、`color`、`created_at`、`updated_at`。

约束：`weekday between 1 and 7`、开始节次不大于结束节次、`weeks` 非空且每项在学期周数内。索引：

- `(student_id, semester_id)`：读取个人课表。
- `(semester_id, weekday)`：按日期/星期计算空闲。
- GIN `(weeks)`：周次包含和相交查询。

### audit_logs

`id`、`actor_user_id`、`action`、`entity_type`、`entity_id`、`before jsonb`、`after jsonb`、`ip_hash`、`created_at`。只追加，不在普通业务中更新或删除。

## 3. 冲突判断

同一 `student_id + semester_id + weekday` 下，排除当前记录后，同时满足：

```text
existing.weeks && new.weeks
existing.start_period <= new.end_period
existing.end_period >= new.start_period
```

即为冲突。校验与写入必须处在同一短事务中，避免并发穿透。

## 4. MVP-B 版本模型

`schedule_versions` 记录版本号、成员、学期、来源、原文件名、课程数、创建者和创建时间；同一成员、学期、版本号唯一。`course_snapshots` 保存该版本整份课表，并为 `schedule_version_id` 建立查询索引。

确认批量导入时先锁定当前成员行，再在一个短事务内写入新版本和完整快照、替换本人当前学期课程并追加 AuditLog。网页单条 CRUD 不生成 Snapshot，只写 AuditLog；MVP-B 历史版本只读，不提供回退。

## 5. 删除策略

- 删除账号不级联删除成员课表；优先禁用账号。
- 删除成员前必须确认无课表，生产环境建议改为 `enabled=false`。
- 学期存在课程时禁止删除。
- 删除课程写入审计后物理删除；历史审计保留前值。
