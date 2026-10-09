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
