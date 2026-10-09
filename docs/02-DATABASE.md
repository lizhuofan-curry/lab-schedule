# 数据库设计（MVP-B）

## v2.1成员工作记录增量契约

`member_work_records`：bigint identity主键，student_id非空外键students（restrict），title/description非空text，status为active/completed/paused，revision正整数默认1，completed_at可空timestamptz(3)，created_at/updated_at非空timestamptz(3)。数据库校验标题去空格后1～120字、说明1～20000字及completed状态当且仅当completed_at非空。索引(student_id,updated_at desc,id desc)覆盖所有者和分页；(student_id,completed_at)覆盖近期完成筛选。原有数据不重置，新表随数据库备份与恢复。

服务端会话确定所有者，创建默认active；转为completed记录完成时间，完成状态内改字不重置，恢复active/paused清除当前完成时间。修改/删除携带expectedRevision，行锁和所有权检查拒绝过期及越权。删除实际删除个人记录，无回收站，不复制个人文字到审计快照。对他人读取仅active/paused及最近7×24小时完成的记录，本人完整管理另行授权；按(updated_at,id)游标分页。

成员任务摘要读取当前轮次及有效参与人，不复制到个人记录；整体完成使用task_rounds.ended_at和原任务规则。查询先在同一短事务锁下同步名单，个人验收状态只作附加展示。

## v2任务增量契约（2026-10-08）

新增collab_tasks（发布者、固定类型/交付模式、整体状态、当前轮次、修订号）、task_rounds（各轮要求、截止时间、人数上限、领取开关、个人/小组目标快照及要求附件）、task_participants（每轮成员、名称快照、活跃状态、重新加入次数）、task_submissions（共同/个人交付键、递增版本、内容、附件、反馈及验收人）、task_events（只追加业务历史）、task_files（私有存储元数据、上传人、大小、SHA-256及关联任务）、task_notifications（收件人、任务/轮次、指派标记、已读状态）。

主键使用identity bigint，附件使用UUID文本标识。JSONB保存明确的ID数组/快照，目标保留历史ID而不级联丢失；发布时校验引用，小组解散保留名称快照。轮次(task_id,number)、参与人(round_id,student_id)、成果(round_id,subject_key,version)唯一，所有外键建立查询索引，状态和正数等CHECK约束。

任务和小组写操作先取得同一事务级advisory lock，保证跨小组名单变化、领取和验收一致；小规模实验室内短事务串行，文件I/O和外部请求不进入事务。要求和目标变更校验revision，验收和重提校验最新成果版本。移出成果保留，重新加入增加generation，避免继承移出前个人通过结果。完成/撤销轮次固定，重开新轮读取当前小组。

附件先私有落盘，再短事务校验额度并写元数据；只允许绑定本人未使用附件或本任务已关联附件。失败不产生任务或成果版本。配额按元数据大小合计；拒绝超额新上传，不删除历史。数据库和文件均纳入备份。

未关联附件由上传者主动清理，不自动到期。新增task_files.deleting_at可空timestamptz和CHECK（删除中必须task_id为空），以及(creator_id,created_at desc,id)的task_id为空部分索引。清理与绑定共用任务锁：短事务标记删除中→事务外删除私有文件（不存在视为已删除）→短事务删除元数据后才释放额度。失败保留标记和额度，供本人重试；删除中不得下载或绑定。已关联附件永远不能通过此接口删除，即使已从当前表单移除也保留历史。备份校验只要求非删除中元数据对应文件完整；恢复保留删除中状态，继续由本人清理。

数据库：PostgreSQL。所有时间戳使用 `timestamptz`；单库业务表使用 `bigint generated always as identity` 主键，认证系统保留其文本 ID；周次使用 `smallint[]`，不保存“1-16周”等展示文本。

## 1. 关系概览

```text
User 1 ── 0..1 Student
Student 1 ── * Course
Semester 1 ── * Period
Semester 1 ── * Course
User 1 ── * AuditLog
Student * ── * Group（通过 GroupMember；每组恰好一个 leader）

MVP-B：Student + Semester 1 ── * ScheduleVersion 1 ── * CourseSnapshot
```

河大统一认证密码不建表、不持久化。河大课表确认导入复用 ScheduleVersion，`source` 取 `henu`；文件模板导入取 `csv` 或 `xlsx`，复制表格导入取 `text`。

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

### groups

`id`、`name`、`created_by_student_id`、`created_at`、`updated_at`。名称必填、最长 40 字且唯一；`created_by_student_id` 仅记录创建来源，当前管理权限由 `group_members.role` 决定。为创建者外键建立索引。

### group_members

`id`、`group_id`、`student_id`、`role`、`created_at`。`role` 仅允许 `leader` / `member`；唯一约束 `(group_id, student_id)` 防止重复加入，部分唯一索引确保每组最多一个 `leader`。`group_id`、`student_id` 均建立查询索引。删除小组级联删除成员关系；成员记录仍采用停用优先策略，不因移出或解散小组删除。

创建小组时在一个短事务中同时写入 `groups`、组长成员关系和 AuditLog。转让组长时先把原组长改为普通成员，再把目标组员改为组长，并在同一事务中写审计；外部请求不参与这些事务。

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
- 删除成员前还必须确认不在任何小组；生产环境停用成员后，其关系保留但不参与目录与空闲计算。
- 学期存在课程时禁止删除。
- 删除课程写入审计后物理删除；历史审计保留前值。
