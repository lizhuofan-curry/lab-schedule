# API契约

所有权取服务端会话，所有写接口校验Zod及来源；禁止信任请求中的成员/发布者身份。

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

不提供独立的成员目录写入接口；成员由开放注册流程自动创建或绑定已有未注册记录。所有登录成员只能查看注册进度，不能通过网页直接修改成员目录。

## 3. 课表

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/students/:id/schedule?semester=&week=` | 成员或游客 | 查看某成员指定周课表；游客看到脱敏学号 |
| GET | `/api/my/courses?semester=` | 登录 | 本人课程列表 |
| POST | `/api/my/courses` | 登录 | 新增本人课程 |
| PATCH | `/api/my/courses/:id` | 登录且为所有者 | 修改本人课程 |
| DELETE | `/api/my/courses/:id` | 登录且为所有者 | 删除本人课程 |

写接口请求不接受 `student_id`。服务端从会话解析本人 `student_id`，标准化 `weeks`，校验学期/节次和冲突后再写入，同时记录 AuditLog。

### 项目小组

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/groups` | 成员或游客 | 查看小组、组长和启用组员；游客学号脱敏 |
| GET | `/api/groups/:id/schedule?week=:week` | 成员或游客 | 查看指定教学周的小组叠加课表；只包含启用组员，游客学号脱敏 |
| POST | `/api/groups` | 登录成员 | 创建小组，当前成员自动成为组长 |
| PATCH | `/api/groups/:id` | 当前组长 | 修改小组名称 |
| DELETE | `/api/groups/:id` | 当前组长 | 解散小组，不删除成员或课表 |
| POST | `/api/groups/:id/members` | 当前组长 | 添加启用成员；请求体 `{ studentId }` |
| DELETE | `/api/groups/:id/members/:studentId` | 当前组长 | 移除普通组员；不能直接移除组长 |
| POST | `/api/groups/:id/leader` | 当前组长 | 把组长转让给已有组员；请求体 `{ studentId }` |

所有写接口使用 Zod 校验，并从服务端会话判断操作者是否为当前组长。客户端传入的组长身份不可信。成员可加入多个小组；同组不能重复加入。所有写操作与成员关系变更在短事务中完成并写 AuditLog。

小组叠加课表为只读接口。`week` 必须是当前学期范围内的整数；未提供时按北京时间使用当前教学周。响应返回小组启用成员、学期节次和该周课程，前端按成员去重后计算每个时间格的忙碌人数。

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

不提供管理配置 API。学期和节次由部署初始化脚本导入；成员由开放注册自动加入。后续如确有在线维护需求，再单独设计受控的维护机制。

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


## 9. 任务、附件与消息读取

GET /api/tasks：成员或游客，游客严格白名单列表字段；GET /api/tasks/:id：仅成员，返回轮次、参与人、成果、业务历史。POST /api/tasks：成员发布，身份来自会话。POST /api/tasks/:id：统一Zod命令，action为edit/targets/claim/close/cancel/reopen/submit/review；管理命令校验发布者，提交校验执行成员，逐人成果只能本人提交。

游客列表白名单明确为id/title/publisher/deadline/status/kind；仅新增kind分类标识（announcement或assigned），供公开/指定分区及历史类型标签，仍无详情、执行人或内部身份字段。列表API保留各状态数据，页面默认仅展示active，上下分区；已完成及已撤销单独筛选，不删除历史。

edit/targets/close/cancel/reopen携带expectedRevision；submit携带roundId、expectedVersion、requestKey；review携带roundId、submissionId、decision及reason。拒绝旧轮和旧版本，requestKey按轮和提交人防重复。类型/交付模式不可编辑，打回原因必填。

POST /api/task-files：成员multipart单文件上传，单文件10MiB、允许扩展名及内容签名验证。GET /api/task-files/:id：成员下载已关联文件；未关联仅上传者可访问，禁止游客，下载禁缓存且nosniff。POST写入校验Origin，JSON请求限256KiB，multipart限11MiB。附件不提供公开URL。

GET /api/task-files/:id?preview=1：复用同一成员鉴权、清理中拒绝和SHA-256/大小校验，固定安全MIME及inline响应；仅PDF、PNG/JPEG、TXT和MD/Markdown。文本/Markdown以text/plain返回，由安全组件渲染，不作为HTML响应。文本预览上限256KiB，超过或不支持格式返回FILE_PREVIEW_TOO_LARGE/FILE_PREVIEW_UNSUPPORTED（422）并提示下载；不改变10MiB上传限制。保持private,no-store、nosniff及沙箱CSP，下载不带preview仍为attachment。客户端只对任务资料打开预览，成果保持下载；游客403、匿名401、未关联他人/清理中文件404。

PDF站内预览使用本地PDF.js逐页绘制，支持上一页/下一页，不执行文档脚本；Worker随前端构建打包。GET /api/pdf-assets/:kind/:name仅提供pdfjs-dist包内的cmaps、standard_fonts及wasm静态依赖，目录、文件名和扩展名均为白名单；未知目录/扩展名/不存在文件404。此接口没有附件或用户数据，不提供任意路径读取；构建须包含对应依赖资源。任务PDF内容仍必须经过上述私有附件鉴权读取，不能借此静态接口访问。

GET /api/task-files：仅返回本人最近50个未关联附件（files及hasMore）；删除中附件返回deleting=true供重试，无其他成员数据。DELETE /api/task-files/:id：严格Zod对象{confirm:true}并校验Origin，仅上传者能主动清理未关联附件；已绑定返回FILE_IN_USE（409），删除中禁止绑定，文件I/O失败返回FILE_DELETE_FAILED（503）并保留可重试状态和额度。游客403、匿名401，读取禁缓存。清理一批后刷新可继续处理更早附件；取消表单后在任何任务附件选择器仍可清理遗留文件。

GET /api/notifications：本人消息与未读有效指派，每页最多200条；可选before为正整数消息ID，nextCursor指向下一页，unread统计全部未读。历史消息可翻页查询，指派弹窗独立于分页。POST /api/notifications：Zod校验本人消息ID集合标已读，每次最多200条，不能标他人。GET /api/task-options：注册启用成员与小组，供发布选择。

task-options的小组包含可执行members及excluded（成员id、姓名、未注册/已停用原因），选择器合并去重后展示实际人数和排除提示。发布返回memberCount和excluded，发布/调整事件记录当次排除快照；进行中指定任务详情targetExclusions返回最新小组排除名单，避免表单打开后成员变化导致静默排除。已结束轮次只读历史快照。

错误：INVALID_TASK/INVALID_COMMAND/INVALID_FILE（422）、FORBIDDEN_OWNER/FORBIDDEN_EXECUTOR（403）、TASK_NOT_FOUND/FILE_NOT_FOUND（404）、STALE_REVISION/STALE_SUBMISSION/TASK_CLOSED/CLAIM_FULL（409）、PAYLOAD_TOO_LARGE（413）、STORAGE_FULL（507）。未知错误不返回内部数据库连接或文件路径。

## 10. 成员工作

GET `/api/students/:id/work?scope=recent|all&cursor=...`：仅注册启用成员；recent返回该成员的近期个人records，all仅允许本人完整管理。records按(updatedAt,id)游标，每页50项返回nextCursor、scope和asOf。cursor为长度受限的base64url编码时间/正整数ID对象，非法scope/游标或未知查询字段拒绝422；不能以参数绕过他人旧记录边界。GET `/api/students/:id/work/tasks?cursor=...`：仅注册启用成员，返回当前承担的进行中及近7天整体完成任务、本人提交验收状态及nextCursor，按任务(updatedAt,id)分页。

POST `/api/my/work`：严格Zod对象{title,description,status}，status为active/completed/paused，默认active；所有者取会话，不接收studentId或完成时间。PATCH `/api/my/work/:id`：{title,description,status,expectedRevision}；DELETE同路径：{expectedRevision}。只操作本人记录，Origin和256KiB体积限制复用现有守卫；修改/删除校验修订。GET `/api/my/work/:id`：仅本人读取，供编辑旧记录。读取禁缓存，游客403、匿名401；WORK_NOT_FOUND/STUDENT_NOT_FOUND为404、FORBIDDEN_OWNER为403、STALE_REVISION为409、输入错误为422，提示刷新或修改输入。

## 11. 已读消息删除（v2.2）

DELETE `/api/notifications`：注册启用成员，校验本站Origin，256KiB请求体上限；严格Zod对象 `{ids: number[], confirm: true}`，ID为正安全整数，1～10000项且不得重复，不接受recipientId等额外字段。一次请求为完整确认集合，不拆成多个部分成功的删除批次；超过上限提示减少选择后重试。

服务端按ID顺序行锁检查现存消息，接收人必须为会话成员且readAt非空；混入他人消息返回FORBIDDEN_NOTIFICATION（403），含仍存在未读返回NOTIFICATION_UNREAD（409），整个请求不删除。已不存在ID视为已清理，重复/并发相同请求可成功收敛。成功返回 `{data:{deleted:实际删除数量}}`，不返回他人消息详情，响应no-store。非法集合或缺失确认返回INVALID_COMMAND（422），来源错误FORBIDDEN_ORIGIN（403），游客403、匿名401。

页面固定发送当前已加载且已读的ID集合（含追加加载），没有“删除本人全部历史”模式；删除后保留当前剩余消息及原ID游标，未加载历史继续可读。数据库删除不扩散到任务、轮次、成果、反馈、附件及业务历史，只记录最小清理数量审计，不复制消息正文。重复请求不会重复写清理审计。当前实现/验证状态见07-TASKS，接口契约不单独证明上线。

## 12. V3独立关系图与历史来源

以下读取仅在服务端`V3_GRAPH_ENABLED=1`时开放，默认关闭；独立于成员页的recent/all接口。身份校验先于功能开关：匿名401、游客403、停用/未绑定成员拒绝；关闭时注册成员404 `GRAPH_DISABLED`。所有响应`private, no-store`，不使用跨会话HTTP缓存，不提供历史写接口。

- GET `/api/graph?scope=all|member|group&id=...`：严格Zod查询，all不能带id，member/group必须带正安全整数id，未知/重复参数422。返回选定范围的全部节点/真实关系、可用范围选项、读取时间及数据版本；无隐式数量截断。个人按该成员、小组按当前启用且注册成员、全体按全部合格成员汇总；来源去重。成员节点不含学号、邮箱或账号ID。
- GET `/api/graph/sources/:key`：仅接受`work:正整数`或`round:正整数`，每次重新检查会话、开关及源记录。work可读其他合格成员现存全部历史文字；round可读相关任务该轮原要求及状态，旧轮不计入当前负担。不提供审计快照、删除记录、附件正文、通知或模型原始输入输出。来源已删/所有者不可用返回404，不读旧缓存。

当前任务关系按现有directIds/groupIds和当前合格小组成员解析，结束轮次按固定参与名单；过去参与与当前承担标记不同。小组范围表示当前成员经历汇总，不能标成历史小组交付。本人工作CRUD、原成员页近期窗口和任务权限照旧。

AI主题契约：每份模型结果绑定当前源数据版本和真实来源ID；版本变化后不显示旧主题，后台重新分析。来源每次重新授权读取，禁止旧请求复活删除内容。仅图与来源读取接口属于本期；不提供候选推荐接口。开关、隔离验证及正式可用性以07-TASKS为准。


## V3.1 关联详情与反馈

GET /api/graph沿用注册启用成员和严格范围参数，private,no-store。edges新增可选detail：AI含reason、fromEvidence、toEvidence、analyzedAt；同课含reason及courses数组(name,location,weekday,startPeriod,endPeriod,weeks)。AI边ID为ai/{work或round来源}/{另一来源}/{similar|method|upstream}，upstream的from指向to；对称关系来源ID排序去重。课程边course/member:{小ID}/member:{大ID}。只返回当前图可见两端，不新增课程或主题节点。

POST /api/graph/feedback严格接收{edgeId,version,reason}，reason trim后1至1000字、version为当前SHA-256。memberFor(write=true)验证会话和Origin，快照再次检查启用状态，所有者来自会话，不接受studentId。仅当前授权有效AI线可反馈；真实、未知或旧版本拒绝。结构校验沿用INVALID_COMMAND 422；服务层INVALID_FEEDBACK 422；GRAPH_CHANGED 409提示重新读取；游客403、匿名401、图关闭404。成功data.message为“已记录，不会立即修改公共关系图。”；重复幂等，不修改公共图，无反馈GET或公开列表。

返回AI前校验两端引用逐字来自当前脱敏标题／说明；拒绝自环、非法类型、未知／完成／旧轮来源及危险HTML／链接。分析异常保留事实图。同课按系统规则核验，不信任模型生成课程事实。历史来源及本人写权限不变。
