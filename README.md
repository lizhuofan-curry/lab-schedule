<div align="center">
<img src="assets/repository-icon.svg" alt="HenuBCI" width="88" />

# HenuBCI

实验室课表、共同空闲、任务与成员工作协作。

[在线使用](https://schedule.henubci.cn) · [项目进度](docs/07-TASKS.md) · [部署指南](docs/04-DEPLOYMENT.md)
</div>

## 功能与状态

| 功能 | 状态 |
| --- | --- |
| 注册登录、游客只读、本人课程、成员课表、共同空闲 | 已上线 |
| Excel/CSV、复制表格、河大同步、图片识别与只读版本 | 已上线 |
| 项目小组、成员管理、小组叠加课表 | 已上线 |
| 公开/指定任务、成果验收、多轮历史、私有附件及预览 | 已上线 |
| 正在做的事、近期任务、站内消息与指派提醒 | 已上线 |
| v2.2 已读消息多选/一键清理 | 已上线 |
| V3 2D工作关系图、Jev候选推荐 | 需求已确认，未开发；3D为后续计划 |

成员只能修改本人课程和工作记录；仅发布者管理、验收自己的任务。游客只能查看脱敏课表、小组、空闲结果和受限任务列表。

## 本地运行

需要Node.js 24、PostgreSQL 17。在`web/`执行：

```bash
npm ci
cp .env.example .env
# 填写数据库及认证配置
npm run db:migrate
npm run db:seed
npm run dev
```

打开`http://localhost:3000`。千问识别可选；所有导入先预览，再由本人确认。图片和教务密码不持久化。

## 验证与部署

```bash
npm run lint
npm test
npm run test:integration
npm run build
npm run test:tasks-browser
```

集成与浏览器使用隔离数据库。浏览器脚本默认读取`.next-v2-prod`，可通过`NEXT_DIST_DIR`选择已构建目录；本次使用`.next-v22`。最新测试数量和证据见[任务清单](docs/07-TASKS.md)。

生产采用腾讯云、Docker Compose和Caddy HTTPS。本地/CI构建Linux镜像，服务器只加载运行；发布前备份数据库及附件，禁止删除数据卷。CI检查代码；容器交付工作流发布镜像，不自动部署服务器。

## 目录与文档

源码沿用`web/src/app`、`components`、`lib`、`db`；测试在`web/test`，迁移在`web/drizzle`，运维脚本在`web/scripts`。

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 开发约束与权限底线 |
| [01 产品需求](docs/01-PRD.md) | 课表、空闲、导入、小组及BR规则 |
| [02 数据库](docs/02-DATABASE.md) / [06 ER图](docs/06-ER_DIAGRAM.md) | 表、约束、关系和事务 |
| [03 API](docs/03-API.md) | 路径、输入、权限和错误 |
| [04 部署](docs/04-DEPLOYMENT.md) / [05 架构](docs/05-ARCHITECTURE.md) | 发布、备份恢复及代码职责 |
| [07 任务清单](docs/07-TASKS.md) | 当前进度、待办和验收证据 |
| [08 河大接口](docs/08-河大教务系统接口.md) | 只读同步流程与安全限制 |
| [09 v2需求](docs/09-PRD-v2.md) | 任务、工作展示和资料预览 |
| [10 v2.2需求](docs/10-PRD-v2.2.md) | 已读消息清理 |
| [11 V3需求](docs/11-PRD-v3.md) | 2D工作关系图与来源权限 |
| [12 V3.1需求](docs/12-PRD-v3.1.md) | DeepSeek工作／任务内容关联、同课关系及质量验收 |
| [需求决策包](docs/09-v2-grill-decision-packet.yaml) | 最终决策、默认及延期事项 |

不提供管理员角色、自动指派、课表版本回退、调休补课或站外通知。密钥、真实成员数据及备份不得提交仓库。

本项目使用[Apache License 2.0](LICENSE)。
