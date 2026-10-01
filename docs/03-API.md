# API 设计（MVP-B / v1）

统一返回 JSON。未登录返回 `401`，无权限返回 `403`，资源不存在返回 `404`，业务校验失败返回 `422`，并包含面向用户的中文 `message`。

## 1. 身份

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/sign-up/email` | 匿名 | 姓名、唯一学号、密码开放注册；已有未绑定记录则绑定，否则创建成员 |
| POST / DELETE | `/api/guest-session` | 匿名 / 游客 | 开启或退出短期游客只读会话 |
| POST | `/api/auth/sign-in/username` | 匿名 | 学号、密码登录 |
| POST | `/api/auth/sign-out` | 登录 | 退出 |
| GET | `/api/me` | 登录 | 当前成员公开资料 |

注册通过用户表与成员表的唯一约束阻止同一学号重复注册；并发请求只能有一个成功。游客会话不写入成员、课程或版本表。

## 2. 成员与注册统计

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/students?q=` | 成员或游客 | 搜索启用成员；游客看到脱敏学号 |
| GET | `/api/registration-stats` | 登录 | 总数、已注册、未注册、待补学号人数、注册率与名单 |

MVP-A 不提供独立的成员目录写入接口；成员由开放注册流程自动创建或绑定已有未注册记录。所有登录成员只能查看注册进度，不能通过网页直接修改成员目录。

## 3. 课表

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/students/:id/schedule?semester=&week=` | 成员或游客 | 查看某成员指定周课表；游客看到脱敏学号 |
| GET | `/api/my/courses?semester=` | 登录 | 本人课程列表 |
| POST | `/api/my/courses` | 登录 | 新增本人课程 |
| PATCH | `/api/my/courses/:id` | 登录且为所有者 | 修改本人课程 |
| DELETE | `/api/my/courses/:id` | 登录且为所有者 | 删除本人课程 |

写接口请求不接受 `student_id`。服务端从会话解析本人 `student_id`，标准化 `weeks`，校验学期/节次和冲突后再写入，同时记录 AuditLog。

## 3.1 项目小组

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/groups` | 成员或游客 | 查看小组、组长和启用组员；游客学号脱敏 |
| POST | `/api/groups` | 登录成员 | 创建小组，当前成员自动成为组长 |
| PATCH | `/api/groups/:id` | 当前组长 | 修改小组名称 |
| DELETE | `/api/groups/:id` | 当前组长 | 解散小组，不删除成员或课表 |
| POST | `/api/groups/:id/members` | 当前组长 | 添加启用成员；请求体 `{ studentId }` |
| DELETE | `/api/groups/:id/members/:studentId` | 当前组长 | 移除普通组员；不能直接移除组长 |
| POST | `/api/groups/:id/leader` | 当前组长 | 把组长转让给已有组员；请求体 `{ studentId }` |

所有写接口使用 Zod 校验，并从服务端会话判断操作者是否为当前组长。客户端传入的组长身份不可信。成员可加入多个小组；同组不能重复加入。所有写操作与成员关系变更在短事务中完成并写 AuditLog。

## 4. 空闲查询

`POST /api/availability/query`

请求：

```json
{
  "week": 5,
  "weekday": 1,
  "studentIds": [1, 2],
  "minimumMinutes": 90,
  "startTime": "08:00",
  "endTime": "18:40"
}
```

当前接口按一个教学周和一个星期查询。`startTime/endTime` 可缩小当天范围，`minimumMinutes` 按实际授课分钟数筛选；返回个人空闲区间、多人共同空闲和满足条件的成员。当前不接受日期范围、节次范围或最少连续节数参数；成员列表去重且限制最大数量。

## 5. 标准课表导入

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/my/schedule-import/template?format=xlsx|csv` | 登录 | 下载固定列模板 |
| POST | `/api/my/schedule-import/preview` | 登录 | 上传最大 2 MB 文件，逐行校验并返回冲突和差异，不写数据库 |
| POST | `/api/my/schedule-import/text-preview` | 登录 | 解析最大 10 万字符的复制表格，识别常见表头和组合上课时间，返回预览但不写数据库 |
| POST | `/api/my/schedule-import/image-ocr` | 登录 | 上传 PNG/JPG/WebP；`mode=local` 在本地识别（最大 8 MB），`mode=vision` 经明确同意后调用千问（小于 7 MB），返回临时结构化草稿，不写数据库 |
| POST | `/api/my/schedule-import/image-preview` | 登录 | 校验本人修正后的图片识别草稿，返回冲突与差异，不写数据库 |
| POST | `/api/my/schedule-import/confirm` | 登录 | 再次校验预览数据，用完整导入结果替换本人当前学期课表并创建版本 |

图片接口使用 multipart 表单：`file` 必填，`mode` 为 `local` 或 `vision`；当 `mode=vision` 时必须同时提交 `visionConsent=true`，否则返回 `VISION_CONSENT_REQUIRED`。模型服务配置、API Key 和调用只存在于服务端，任何响应与日志不得暴露密钥。智能识别会返回课程级置信度和 `reviewFields`，供前端醒目标记需要人工复核的字段。

模板列固定为：课程名称、教师、地点、星期、开始节次、结束节次、周次、备注、颜色。复制表格可使用常见别名，并支持 `1-18周 五[3-5] 教室` 格式的组合字段。确认接口 `source` 可为 `csv`、`xlsx`、`text`、`henu` 或 `image`，不接受 `student_id`，所有者只能来自服务端会话。一次最多 200 门课程；错误、重复或冲突存在时拒绝确认。图片、OCR 原文和模型原始响应不进入确认载荷，不持久化。

## 6. 河大课表同步（实验功能）

`POST /api/my/henu-sync` 只生成预览，不写数据库。请求包含当前账号学号和一次性密码；服务端必须验证请求学号等于会话成员学号，并再次校验教务系统返回身份。密码不得保存或写日志。预览确认后调用 `/api/my/schedule-import/confirm`，以 `source: "henu"` 创建整表版本、快照和审计记录。

## 7. 初始化配置

MVP-A 不提供管理配置 API。学期和节次由部署初始化脚本导入；成员由开放注册自动加入。后续如确有在线维护需求，再单独设计受控的维护机制。

## 8. 关键错误码

- `CONFLICT`：学号已注册，或并发注册时该学号已被另一请求占用。
- `STUDENT_ALREADY_REGISTERED`：该成员已绑定账号。
- `COURSE_CONFLICT`：存在时间重叠课程，并返回冲突课程摘要。
- `DUPLICATE_COURSE`：完全重复课程。
- `OUTSIDE_SEMESTER`：日期不在学期范围内。
- `FORBIDDEN_OWNER`：试图修改他人课程。
- `FILE_INVALID`：文件类型、大小、模板列或内容无法读取。
- `IMPORT_INVALID`：确认数据存在错误、重复、冲突或学期已经变化。
- `FORBIDDEN_STUDENT`：请求同步的学号不是当前登录成员本人。
- `IDENTITY_MISMATCH`：教务系统返回身份与当前登录成员不一致。
- `HENU_LOGIN_FAILED`：统一认证失败、需要验证码或外部系统暂时不可用。
- `GROUP_NAME_TAKEN`：已经存在同名小组。
- `FORBIDDEN_GROUP_LEADER`：当前成员不是该组组长。
- `GROUP_MEMBER_EXISTS`：成员已经在该小组中。
- `CANNOT_REMOVE_LEADER`：必须先转让组长，不能直接移除当前组长。
