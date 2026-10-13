# 部署与运维

正式站：[schedule.henubci.cn](https://schedule.henubci.cn)。腾讯云香港Ubuntu 24.04，2核2GB/40GB；项目`/opt/tongpin-schedule`，Compose工作目录`web/`。发布记录只维护在[07-TASKS.md](07-TASKS.md)。

## 1. 配置与持久化

| 项目 | 规则 |
| --- | --- |
| 网络 | 公网22/80/443；数据库仅127.0.0.1:5433，Caddy反代应用 |
| 生产配置 | 服务器`web/.env`，权限600；不随源码包上传、不输出到日志 |
| 认证 | APP_DOMAIN、APP_URL、BETTER_AUTH_TRUSTED_ORIGINS使用同一正式HTTPS来源；数据库和登录密钥分别随机生成 |
| 可选识别 | SCHEDULE_VISION_PROVIDER/MODEL、DASHSCOPE_API_KEY/BASE_URL仅服务端使用；留空仍可本地OCR |
| 数据卷 | postgres_data、task_uploads、caddy_data、caddy_config必须保留 |
| 附件 | 容器`/app/data/task-files`，UID1001可写；禁止放public或Caddy静态目录 |
| 配额 | 正式每人64MiB、全站128MiB；代码默认200MiB/2GiB；单文件10MiB，磁盘预留256MiB |

扩容同时核算文件、35天备份和镜像空间；不足时拒绝新上传，不删除历史。模型Key及服务器私钥不得进入仓库、聊天或截图。

## 2. 发布步骤

1. 本地完成lint、单元、类型/生产构建及受影响集成/浏览器验证。
2. 在本地或CI构建Linux/amd64 Docker镜像，检查运行依赖及PDF资源。Next页面构建并发保持1；正式2GB服务器不编译。
3. 打包已核验源码和文档，排除.env、node_modules、构建缓存、测试数据/截图、备份及无关附件；生成逐文件SHA-256清单。
4. 只读检查正式健康、磁盘、实际镜像及业务数量，上传后核对归档与镜像哈希。
5. 保留旧源码和旧app/migrate镜像标签，生成成套备份并核对清单，再切换镜像。
6. 先备份再执行migrate。即使无新增迁移，镜像切换后也重建migrate服务、确认既有迁移/seed退出0，避免备份恢复应用时依赖状态不一致。不得更换原数据卷或覆盖生产.env。
7. 等待app/db健康，核对数据与源码清单；正式桌面/390px验证本次功能及权限。
8. 精确清理临时验收数据，再备份、校验服务器外加密副本，记录实际镜像、数量和结果。

首次部署使用`web/.env.production.example`准备配置、域名A记录指向服务器。Compose启动顺序为db健康→migrate/seed成功→app健康→Caddy；初始化不携带本机测试数据。保留`web/public`空目录。

常用检查（服务器`web/`）：

```bash
sudo docker compose ps
curl -fsS https://schedule.henubci.cn/api/health
sudo docker compose exec -T app node scripts/verify-task-files.mjs
```

CI容器发布不等于服务器已上线。若SSH或健康超时，先恢复连接并确认远端进程状态，不反复提交构建。控制台重启仅恢复服务器，不证明新版本已发布。

## 3. 备份

```bash
sudo sh scripts/backup-db.sh
```

脚本暂停原先运行的应用，验证关联，生成同时间戳`.dump`、`.files.tar`、`.sha256`并恢复应用。三份必须成套保留、复制和校验，个人工作记录随整库保存；删除中的未关联文件允许重试状态保留。

每日03:15运行，保留35天；服务器外至少一份加密副本。私钥仅保存在维护者本机，必须能解密并核对成套哈希；密文下载成功不等于恢复可用。每月在独立数据库/Compose做恢复演练，发布迁移前额外备份。

```cron
15 3 * * * cd /opt/tongpin-schedule/web && /bin/sh scripts/backup-db.sh >> /var/log/tongpin-backup.log 2>&1
```

## 4. 恢复

仅在确认覆盖目标后执行：

```bash
sudo env RESTORE_CONFIRM=RESTORE_SCHEDULE sh scripts/restore-db.sh backups/schedule-时间.dump
```

- 先验证tar可读、路径/类型/哈希，拒绝链接和损坏归档；此时不停止或覆盖正式库。
- 恢复到独立`schedule_restore_*`库，升级现有迁移，校验文件大小/SHA及关联。旧v1仅数据库备份需显式`RESTORE_LEGACY_DB_ONLY=1`；含v2表必须成套。
- 预检成功后停止应用，保存`pre-restore-*`成套副本，再覆盖数据库、提取UUID文件并复查；不递归清空附件卷。
- 覆盖开始后失败，应用保持停止，人工用恢复前副本处理。恢复数据成功但应用未健康也必须报失败；原本停止的应用保持停止。
- 验证账号绑定、课程、任务轮次、成果、消息、工作记录以及真实HTTP附件内容；命令退出0不足以证明业务可用。

## 5. 回退与数据保护

健康失败恢复旧应用镜像和对应源码，保留新表、业务数据及附件卷；禁止`docker compose down -v`。应用回退不恢复用户明确删除的消息或记录，也不等同于数据库回滚。

正式验收仅使用明确临时身份和精确任务/文件ID；清理前备份并验证归属及无真实参与者，数据库用事务，文件I/O在事务外。不按名称模糊删除，不重置序列。

## 6. V3配置与回退边界

`V3_GRAPH_ENABLED`、`V3_ANALYSIS_ENABLED`默认均为0，分别控制独立图/历史来源与外部模型计算。DeepSeek使用独立`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-flash`。密钥只填本机/服务器受保护.env，不修改example为真实值，不输出完整Compose展开结果。

新增0011迁移只建派生分析状态，不改任务/记录。先在隔离库验证迁移、权限及恢复，再按既有备份和本地Linux镜像流程发布；本地Windows构建不替代Linux镜像或正式验收。不得因模型调用失败反复开启收费重试；后台30秒/2分钟/每小时退避，不设置默认月度截断。

自动分析依赖持续运行的Node应用，进程内循环加数据库租约；无需新容器或本地大模型。升级/重启后自动观察最新版本，旧租约到期可恢复。只读图与手动指定不依赖外部模型成功。停止AI时设分析开关0并重建应用；收回历史读取需同时关闭图开关并重建，原成员页仍为近期。回退旧应用可保留0011表，不恢复用户已删除来源。

## 可选访问统计（Umami）

统计服务使用独立的 Umami 3.4.0 容器和独立 PostgreSQL 数据卷，不复用业务数据库或业务账号。应用容器限制512MiB，统计数据库限制192MiB；镜像初次拉取后通过 `UMAMI_IMAGE` 固定摘要，升级需另行验收。

在 `web/.env` 安全配置 `UMAMI_DATABASE_PASSWORD`（随机十六进制）、`UMAMI_APP_SECRET`、`UMAMI_TWO_FACTOR_KEY`（64位十六进制），添加统计网站后填写公开标识 `UMAMI_WEBSITE_ID`。`ANALYTICS_ENABLED=0` 默认关闭，设为1并重启网站后接入。凭据不得提交。首次仅开放本机3001端口，替换默认密码、验证默认密码被拒绝后，才使用 `Caddyfile.analytics` 开放 `analytics.henubci.cn`；网站仅代理 `/metrics/script.js` 和 `/metrics/api/send`，不通过该前缀暴露统计管理API。

```bash
docker compose -f compose.yaml -f compose.analytics.yaml up -d --no-build --wait umami-db umami
```

统计面板使用独立登录，不增加HenuBCI产品管理员。不要开放分享链接或使用成员学号作为统计身份。统计脚本保留Do Not Track设置，发送前隐藏动态业务编号、清除查询参数、hash、标题及referrer，只保留路径类别和固定点击事件，不采集姓名、学号、表单内容或工作任务正文。Umami的UV是匿名估算，多人在同一网络和浏览器环境下可能无法完全区分；请求被浏览器拦截时会漏计。统计从启用后开始，不能还原此前未记录的访问。

统计数据库备份由 `scripts/backup-analytics.sh` 独立执行，输出到 `web/backups/analytics/`，保留35天，不混入业务数据库恢复。正式定时任务 `/etc/cron.d/henubci-analytics-backup` 使用服务器系统时区；UTC服务器每日04:15相当于北京时间12:15。备份SHA检查后，可在独立临时统计库实际 `pg_restore` 并比对网站和事件数量；不得覆盖在线统计库测试恢复。业务原备份流程保持独立。

撤回统计接入时先设 `ANALYTICS_ENABLED=0` 并重启网站；恢复原Caddy配置、停统计容器即可，不删除数据卷。网站和统计服务故障应分别检查，统计故障不得阻断登录、课表、任务或关系图。
