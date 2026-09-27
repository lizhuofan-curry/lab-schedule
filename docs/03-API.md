# API 设计（MVP-A）

统一返回 JSON。未登录返回 `401`，无权限返回 `403`，资源不存在返回 `404`，业务校验失败返回 `422`，并包含面向用户的中文 `message`。

## 1. 身份

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register-member` | 匿名 | 姓名、学号、密码匹配名册后注册 |
| POST | `/api/auth/sign-in/username` | 匿名 | 学号、密码登录 |
| POST | `/api/auth/sign-out` | 登录 | 退出 |
| GET | `/api/me` | 登录 | 当前成员公开资料 |

注册接口必须在一个事务内锁定匹配的未绑定名册记录，再创建账号并绑定，避免同一学号并发注册两次。

## 2. 成员与注册统计

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/students?q=` | 登录 | 搜索启用成员，仅返回公开字段 |
| GET | `/api/registration-stats` | 登录 | 总数、已注册、未注册、待补学号人数、注册率与名单 |

MVP-A 不提供成员名册写入接口；名册由项目部署初始化数据导入。所有登录成员只能查看注册进度，不能通过网页修改名册。

## 3. 课表

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/students/:id/schedule?semester=&week=` | 登录 | 查看某成员指定周课表 |
| GET | `/api/my/courses?semester=` | 登录 | 本人课程列表 |
| POST | `/api/my/courses` | 登录 | 新增本人课程 |
| PATCH | `/api/my/courses/:id` | 登录且为所有者 | 修改本人课程 |
| DELETE | `/api/my/courses/:id` | 登录且为所有者 | 删除本人课程 |

写接口请求不接受 `student_id`。服务端从会话解析本人 `student_id`，标准化 `weeks`，校验学期/节次和冲突后再写入，同时记录 AuditLog。

## 4. 空闲查询

`POST /api/availability/query`

请求：

```json
{
  "date": "2026-09-28",
  "studentIds": [1, 2],
  "minimumConsecutivePeriods": 2
}
```

响应包含：目标教学周、全天没课成员、逐节空闲成员、共同空闲节次和连续区间。日期必须落在学期内；成员列表去重且限制最大数量。

## 5. 初始化配置

MVP-A 不提供管理配置 API。成员名册、学期和节次由部署初始化脚本导入；后续如确有多人在线维护需求，再单独设计受控的维护机制。

## 6. 关键错误码

- `ROSTER_NOT_FOUND`：姓名学号不在名册或不匹配。
- `STUDENT_ALREADY_REGISTERED`：该成员已绑定账号。
- `COURSE_CONFLICT`：存在时间重叠课程，并返回冲突课程摘要。
- `DUPLICATE_COURSE`：完全重复课程。
- `OUTSIDE_SEMESTER`：日期不在学期范围内。
- `FORBIDDEN_OWNER`：试图修改他人课程。
