# 腾讯云部署与运维

目标环境：腾讯云轻量应用服务器，中国香港，Ubuntu 24.04，2 核 2 GB，40 GB SSD。MVP-A 使用 Docker Compose 运行 `app + postgres + caddy`，服务器不承担日常源码开发。

## 1. 对外端口

- `22/tcp`：SSH，建议后续将来源限制为项目维护者常用 IP。
- `80/tcp`：HTTP，仅用于跳转 HTTPS 和证书签发。
- `443/tcp`：HTTPS。
- PostgreSQL 的 `5432` 不映射到公网；仅通过 `127.0.0.1:5433` 绑定本机 loopback，供本地集成测试连接（`npm run test:integration` 连独立 `schedule_test` 库），不暴露公网。

## 2. 环境变量

生产环境以 `web/.env.production.example` 为模板，在服务器的 `web/.env` 中填写：

- `APP_DOMAIN`：正式域名，例如 `schedule.example.com`，不带 `https://`。
- `APP_URL`：与域名对应的完整 HTTPS 地址。
- `BETTER_AUTH_TRUSTED_ORIGINS`：允许登录请求的正式来源，通常与 `APP_URL` 相同。
- `POSTGRES_PASSWORD`：数据库随机强密码。
- `BETTER_AUTH_SECRET`：至少 32 字节的随机登录密钥。
- `SCHEDULE_VISION_PROVIDER`：可选智能识别提供方，当前填写 `qwen`；留空时仍可使用本地 OCR。
- `SCHEDULE_VISION_MODEL`：千问多模态模型 ID，例如 `qwen3.8-flash`。
- `DASHSCOPE_API_KEY`：标准 API Key，只在服务端和应用容器中使用，不得提交或写入日志。
- `DASHSCOPE_BASE_URL`：与 Key 所属工作空间及地域一致的 OpenAI 兼容地址，包含 `/compatible-mode/v1`。

可以在服务器执行 `openssl rand -hex 32` 分别生成两个不同的随机值。系统不设置管理员账号。`.env` 不进入 Git，不粘贴到聊天、截图或提交记录中。

本地开发若需要通过局域网 IP 而不是 `localhost` 访问，可在本地 `.env` 设置 `NEXT_ALLOWED_DEV_ORIGINS=局域网IP`，并确保 `BETTER_AUTH_URL` 与 `BETTER_AUTH_TRUSTED_ORIGINS` 包含实际访问地址；生产环境使用正式 HTTPS 域名，不需要该开发变量。

## 3. 首次发布

1. 在本地 `web` 目录完成 `npm ci`、`npm run lint`、`npm test`、`npm run test:integration`、`npm run test:performance` 和 `npm run build`。
2. 将仓库部署到服务器的 `/opt/tongpin-schedule`，Docker Compose 工作目录为 `/opt/tongpin-schedule/web`；不要上传 `.env`、`.next`、`node_modules` 或 `backups`。
   仓库会保留空的 `web/public` 目录；Docker 生产镜像构建依赖该目录，即使当前没有额外静态文件也不要删除。
3. 在服务器复制并编辑生产配置：

   ```bash
   cd /opt/tongpin-schedule/web
   cp .env.production.example .env
   nano .env
   ```

   若需要从现有受保护环境文件继承千问配置，同时重新生成生产数据库密码与登录密钥，可使用 `scripts/prepare-production-env.sh 源文件 APP_URL APP_DOMAIN`。脚本不会输出密钥，生成后会删除源文件并把 `.env` 权限设为 `600`。首次通过 IP 做 HTTP 冒烟测试时，`APP_URL` 与 `APP_DOMAIN` 可临时填写 `http://服务器公网IP`；正式开放前必须改为 HTTPS 域名并重新构建应用。

4. 确认域名 A 记录已经指向服务器公网 IP，腾讯云防火墙只开放 `22`、`80`、`443`。
5. 构建并启动：

   ```bash
   sudo docker compose build
   sudo docker compose up -d
   sudo docker compose ps
   ```

   `migrate` 服务会先执行数据库迁移和学期/节次初始化，成功后应用才启动。

6. 检查容器和健康接口：

   ```bash
   sudo docker compose ps
   sudo docker compose logs --tail=100 migrate app caddy
   curl -fsS https://你的域名/api/health
   ```

7. 在真实浏览器完成登录、注册统计、查看他人课表、本人课程增删改和共同空闲冒烟测试。

2 GB 内存下构建可能产生压力，优先使用 CI 构建镜像，服务器只拉取并运行。

## 4. 后续更新

仅修改页面或业务代码时，数据库卷不会因为重建应用而消失：

```bash
cd /opt/tongpin-schedule/web
sudo sh scripts/backup-db.sh
# 上传新版本或拉取已确认的 Git 提交
sudo docker compose build app migrate
sudo docker compose up -d
sudo docker compose ps
```

如果新版本包含数据库迁移，必须先完成备份，再启动 `migrate`。更新后检查健康接口和关键页面。禁止使用 `docker compose down -v`，因为 `-v` 会删除 PostgreSQL 和 Caddy 数据卷。

样式、字体、页面布局和普通检索逻辑通常只需重建 `app`；数据库结构调整需要迁移；域名或登录来源变化需要同步修改 `.env` 并重建应用。

## 5. 域名与 HTTPS

域名 A 记录指向服务器公网 IP。Caddy 负责申请与续期证书，应用容器只在内部网络监听。域名未就绪时可先用 IP 验证 HTTP，但正式登录必须使用 HTTPS。

## 6. 备份与恢复

- 手工备份：在 `web` 目录执行 `sudo sh scripts/backup-db.sh`。备份保存在 `web/backups`，脚本保留最近 35 天，覆盖最近 7 天和最近 4 周。
- 每日自动备份可用服务器 `crontab -e` 添加：

  ```cron
  15 3 * * * cd /opt/tongpin-schedule/web && /bin/sh scripts/backup-db.sh >> /var/log/tongpin-backup.log 2>&1
  ```

- 备份至少有一份复制到服务器之外。
- 每月执行一次恢复演练并记录耗时和结果。
- 发布数据库迁移前额外备份。

恢复命令会先再次备份当前数据库，并要求显式确认：

```bash
cd /opt/tongpin-schedule/web
sudo env RESTORE_CONFIRM=RESTORE_SCHEDULE sh scripts/restore-db.sh backups/schedule-时间.dump
```

恢复演练必须验证：用户、成员绑定、课程、学期和审计记录均可读取，而不只是命令返回成功。

## 7. 本地数据是否迁移

首次上线前必须二选一：

- **全新生产库**：只运行迁移和正式名册初始化，测试账号和测试课程不带到服务器；适合当前本地数据主要用于验收的情况。
- **保留本地数据**：先对本地 PostgreSQL 执行 `scripts/backup-db.sh`，把生成的 `.dump` 安全上传到服务器，再使用恢复脚本导入。恢复前确认备份中不包含测试成员或错误课表。

本地 Docker 数据卷不会随源代码上传而自动出现在服务器上。

## 8. 2026-09-28 首次服务器发布记录

- 服务器：腾讯云 Ubuntu 24.04，代码提交 `91ee70b`，仓库位于 `/opt/tongpin-schedule`。
- 发布形态：使用全新 PostgreSQL 数据卷；迁移成功，初始化 1 个学期和 13 个节次；只预置当前已确认的李卓凡、李昱辉两条未注册名册记录，没有迁移本机账号或课表。
- 运行检查：`db` 与 `app` 容器健康，Caddy 正常监听 `80/443`；服务器内部与公网 IP 的 `/api/health`、`/register` 均返回 HTTP 200，未登录访问受保护的图片导入页返回预期重定向。
- 备份检查：已生成首次自定义格式备份，并保留腾讯云已有 root 定时任务的同时加入每日 03:15 备份。
- 异地副本：已将首次备份下载到维护者本机 `web/backups/server-schedule-20260928T115518Z.dump`；文件大小 35,371 字节，服务器与本机 SHA-256 均为 `d8913ed72e3fd605ddabda3150d3693dbce73068a5d09bcff982d56c4f6f230e`。`web/backups` 已被 Git 忽略，副本不得进入仓库或公开网盘。
- 恢复演练：备份已恢复到隔离临时数据库，核对得到 1 个学期、13 个节次、2 位成员、0 门课程和 0 条审计记录；验证后已删除临时数据库，生产库未被覆盖。
- 尚未完成：`schedule.henubci.cn` DNS、Caddy HTTPS 证书，以及注册登录后的生产浏览器业务冒烟测试。当前 IP HTTP 地址只用于上线前验收，不作为正式登录入口。首次服务器外副本已建立，正式开放后仍需定期更新并校验异地副本。

## 9. 2026-09-28 正式域名与 HTTPS 验证记录

- DNS：`schedule.henubci.cn` 的 A 记录在本机默认解析器与公共 `1.1.1.1` 上均解析为 `43.132.209.32`，TTL 为 600 秒。
- 生产来源：服务器 `.env` 已切换为 `APP_DOMAIN=schedule.henubci.cn`，应用地址和 Better Auth 可信来源均为 `https://schedule.henubci.cn`；文件权限保持 `600`，未输出任何密钥。
- 证书：Caddy 已通过 Let’s Encrypt HTTP-01 验证并成功取得证书，自动续期数据保存在 Caddy 持久卷中。
- 公网检查：HTTP 请求返回 308 并跳转 HTTPS；`https://schedule.henubci.cn/api/health` 返回 `{"status":"ok"}` 与 HTTP 200，TLS 校验结果为 0；注册页返回 200，未登录访问图片导入页会重定向到正式域名登录页。

## 10. 2026-09-28 开放注册与游客只读发布记录

- 发布代码：提交 `a9943aa` 已部署到腾讯云，应用、数据库与 Caddy 容器均正常，应用健康检查通过。
- 发布前备份：已生成 `backups/schedule-20260928T153856Z.dump`；本次没有数据库结构迁移，也没有删除或覆盖现有成员数据。
- 游客生产冒烟：创建游客会话、打开总览和读取成员接口均返回 HTTP 200；游客看到的学号全部脱敏，没有暴露完整长学号。
- 权限边界：游客直接访问“我的课表”或“注册情况”会返回 307 并跳转总览；游客调用本人课程写接口返回 HTTP 401。
- 开放注册：代码检查、48 项单元测试、24 项数据库/权限集成测试和生产构建均通过；为避免污染正式数据库，没有创建虚假生产账号，仍需一名真实成员完成“注册—登录—进入我的课表”的最终生产业务冒烟。
- 数据检查：切换 HTTPS 后仍有 1 个学期、13 个节次、2 条未注册名册，账号和课程均为 0；每日 03:15 备份任务仍在。
- 待人工验收：由真实成员在正式 HTTPS 页面完成注册、登录、注册统计、查看他人课表、本人课程增删改、共同空闲及图片识别导入冒烟。

## 11. 2026-10-01 项目小组发布记录

- 发布代码：项目小组功能提交 `294830c` 与本地验收文档提交 `d161c82` 已发布到腾讯云；服务器代码由 `6a1bee2` 快进更新。
- 发布前备份：生成 `backups/schedule-20261001T085450Z.dump`，大小 61,564 字节，SHA-256 为 `c1a178fae4c44ad2a7d88ea93d6cccd09bd1a0cce0c8787d8eaa2db04a7fefdc`；同名服务器外副本已下载到本机受 Git 忽略的 `web/backups`，校验值一致。
- 数据库迁移：`0007_bright_big_bertha.sql` 执行成功，`groups` 与 `group_members` 可查询，Drizzle 共记录 8 次迁移；没有恢复、覆盖或删除原有生产数据。
- 容器与公网：应用和 PostgreSQL 健康，Caddy 持续运行；正式 HTTPS 健康接口返回 200 且 TLS 校验通过，HTTP 正确 308 跳转 HTTPS。
- 生产游客冒烟：游客可进入项目小组页面，只看到脱敏学号且没有管理入口；游客调用小组创建接口返回 401。390 px 手机宽度下小组卡片与底部导航显示正常。
- 成员写操作：创建、改名、添加/移除成员、转让组长和解散已在本地双账号浏览器与数据库权限集成测试中通过；正式环境未创建虚假成员或测试小组，仍由真实成员后续进行生产写操作冒烟。

## 12. 2026-10-01 小组叠加课表发布记录

- 发布代码：提交 `2137cfd` 已部署到腾讯云；生产构建包含 `/groups/[id]` 页面和 `/api/groups/[id]/schedule` 接口。
- 发布前备份：生成 `backups/schedule-20261001T095153Z.dump`，大小 68,845 字节，SHA-256 为 `1bf5bccbc525552fdc778a00553300cef780b81bdfbd39a2c88324f484f93f80`。
- 容器状态：迁移容器退出码为 0，应用和 PostgreSQL 健康，Caddy 持续运行；本次没有新增数据库迁移，也没有恢复、覆盖或删除生产数据。
- 公网检查：正式 HTTPS 健康接口返回 `ok`，HTTP 正确返回 308 并跳转 HTTPS；游客可打开小组叠加课表页面且无框架错误覆盖层。
- 功能冒烟：生产小组可按第 5 周读取 2 位启用成员和 24 条课程；游客所见学号全部脱敏，热力格按节次显示 0、1 或 2 人有课。
