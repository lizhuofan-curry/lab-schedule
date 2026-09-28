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
2. 将 `web` 目录上传到服务器，例如 `/opt/tongpin-schedule`；不要上传 `.env`、`.next`、`node_modules` 或 `backups`。
3. 在服务器复制并编辑生产配置：

   ```bash
   cd /opt/tongpin-schedule
   cp .env.production.example .env
   nano .env
   ```

4. 确认域名 A 记录已经指向服务器公网 IP，腾讯云防火墙只开放 `22`、`80`、`443`。
5. 构建并启动：

   ```bash
   docker compose build
   docker compose up -d
   docker compose ps
   ```

   `migrate` 服务会先执行数据库迁移和学期/节次初始化，成功后应用才启动。

6. 检查容器和健康接口：

   ```bash
   docker compose ps
   docker compose logs --tail=100 migrate app caddy
   curl -fsS https://你的域名/api/health
   ```

7. 在真实浏览器完成登录、注册统计、查看他人课表、本人课程增删改和共同空闲冒烟测试。

2 GB 内存下构建可能产生压力，优先使用 CI 构建镜像，服务器只拉取并运行。

## 4. 后续更新

仅修改页面或业务代码时，数据库卷不会因为重建应用而消失：

```bash
cd /opt/tongpin-schedule
sh scripts/backup-db.sh
# 上传新版本或拉取已确认的 Git 提交
docker compose build app migrate
docker compose up -d
docker compose ps
```

如果新版本包含数据库迁移，必须先完成备份，再启动 `migrate`。更新后检查健康接口和关键页面。禁止使用 `docker compose down -v`，因为 `-v` 会删除 PostgreSQL 和 Caddy 数据卷。

样式、字体、页面布局和普通检索逻辑通常只需重建 `app`；数据库结构调整需要迁移；域名或登录来源变化需要同步修改 `.env` 并重建应用。

## 5. 域名与 HTTPS

域名 A 记录指向服务器公网 IP。Caddy 负责申请与续期证书，应用容器只在内部网络监听。域名未就绪时可先用 IP 验证 HTTP，但正式登录必须使用 HTTPS。

## 6. 备份与恢复

- 手工备份：`sh scripts/backup-db.sh`。备份保存在 `web/backups`，脚本保留最近 35 天，覆盖最近 7 天和最近 4 周。
- 每日自动备份可用服务器 `crontab -e` 添加：

  ```cron
  15 3 * * * cd /opt/tongpin-schedule && /bin/sh scripts/backup-db.sh >> /var/log/tongpin-backup.log 2>&1
  ```

- 备份至少有一份复制到服务器之外。
- 每月执行一次恢复演练并记录耗时和结果。
- 发布数据库迁移前额外备份。

恢复命令会先再次备份当前数据库，并要求显式确认：

```bash
cd /opt/tongpin-schedule
RESTORE_CONFIRM=RESTORE_SCHEDULE sh scripts/restore-db.sh backups/schedule-时间.dump
```

恢复演练必须验证：用户、成员绑定、课程、学期和审计记录均可读取，而不只是命令返回成功。

## 7. 本地数据是否迁移

首次上线前必须二选一：

- **全新生产库**：只运行迁移和正式名册初始化，测试账号和测试课程不带到服务器；适合当前本地数据主要用于验收的情况。
- **保留本地数据**：先对本地 PostgreSQL 执行 `scripts/backup-db.sh`，把生成的 `.dump` 安全上传到服务器，再使用恢复脚本导入。恢复前确认备份中不包含测试成员或错误课表。

本地 Docker 数据卷不会随源代码上传而自动出现在服务器上。
