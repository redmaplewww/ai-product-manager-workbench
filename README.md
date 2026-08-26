# PM Studio

面向内部团队的持续型 AI 产品经理工作台。它把对话、来源、候选记忆和产品规划转换成可审计的变更提案；只有管理员或产品编辑批准后，正式产品基线才会产生新版本。

## 已实现

- 单组织账号与 `admin` / `editor` / `reviewer` RBAC，Argon2id 密码和安全会话 Cookie。
- 首次登录强制改密、同源写请求校验、登录失败限流和脱敏审计。
- 项目总览与桌面三栏、移动分段式产品工作台。
- 持久化对话、不可变产品基线、结构化提案 Diff、`baseVersion` 乐观锁审批。
- 候选/确认/遗忘/替代记忆，以及完整来源和 Agent 运行轨迹。
- OpenAI Agents SDK 经理式编排、DeepSeek 独立评审适配和无密钥 Demo 回退。
- 文件登记、网页摄取、DNS 后 SSRF 防护、体积和超时限制。
- 自进化发布硬门槛、管理员审批、审计事件和回滚状态。
- 管理员工作台可查看成员、控制模型路由并审批或回滚自进化候选。
- PostgreSQL/pgvector 生产迁移、S3 兼容存储配置、Web/Worker 容器拓扑。

## 本地运行

```powershell
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。首次本地运行会在 `data/studio.json` 建立可恢复的开发数据。仅在未配置环境变量的本地开发模式中，会建立 `admin`、`editor`、`reviewer` 演示账号，共同密码 `Admin123!`；共享或公开可访问的部署必须在首次启动前设置 `PM_STUDIO_BOOTSTRAP_PASSWORD`。没有模型密钥时，界面会明确显示 `DEMO MODE`，不会把模板输出标成真实模型结果。

复制 `.env.example` 为 `.env.local` 后配置真实模型。至少 32 位随机 `SESSION_SECRET` 是生产必填项。模型密钥只从进程环境读取，不进入状态文件、数据库或日志。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

健康检查为 `GET /api/health`。SSE 运行记录为 `GET /api/runs/:id/events`。管理员可运行 `pnpm admin:create` 交互式创建新管理员。

管理员登录后可从右上角进入 `/admin`。评审成员可以在项目对话中评论并生成修改提案，但不能批准提案、确认记忆、上传来源或创建项目。

## 生产部署

`compose.yaml` 给出 Web、Worker、PostgreSQL/pgvector 和 MinIO 拓扑，`infra/migrations/0001_init.sql` 是生产数据库基线。Compose 会拒绝缺少 PostgreSQL 和 MinIO 凭据的启动；部署时还必须通过平台 Secret Manager 注入模型密钥、会话密钥和 `PM_STUDIO_BOOTSTRAP_PASSWORD`。

当前可运行开发配置使用原子 JSON 状态存储，适合本机验收；生产 SQL 模型已提供，但将 `store.ts` 切换为 PostgreSQL repository 仍是上线前必须完成的部署适配，不能把开发存储用于多副本生产。

完整运行图、数据边界和生产替换点见 [`docs/architecture.md`](docs/architecture.md)。

## 安全边界

- AI 只创建候选提案，不能直接修改正式基线、外部任务系统或代码。
- 网页来源视为不可信输入；禁止私网、回环、凭据 URL 和自动重定向。
- 评审角色不能发送改变产品状态的消息，也不能批准提案或记忆。
- 自进化候选必须满足零越权、结构合法、无关键回退和至少 5% 综合提升，且只能由管理员发布。
