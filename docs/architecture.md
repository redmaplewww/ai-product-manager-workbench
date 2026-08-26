# AI 产品经理工作台架构

## 1. 系统边界

工作台只有一个面向用户的 AI 产品经理。专业 Agent 不接管会话，只向经理返回结构化结论。AI 的任何输出都只能进入候选提案或候选记忆；正式产品基线仅能由管理员或产品编辑审批生成新版本。

首版是私有云、单组织、多成员系统。外部代码仓库、任务平台和发布系统均不在写权限范围内。未来的 Codex SDK 工程专家只允许读取已关联仓库并生成技术可行性报告。

## 2. 运行拓扑

```text
Browser -> Next.js REST/SSE -> durable job queue -> Worker
                    |                |
                    v                v
              PostgreSQL       Agent orchestrator
               pgvector       /        |         \
                    |      OpenAI   DeepSeek   optional Codex
                    v
            S3-compatible objects
```

开发配置为便于本机验收，使用 `data/studio.json` 原子替换保存状态并在 Web 进程内执行任务。生产配置必须使用 PostgreSQL repository、持久队列与对象存储，不能运行多副本 JSON 存储。

## 3. Agent 运行图

1. PM 总控读取已批准基线、最近对话、已确认记忆、候选记忆、来源片段和未解决冲突。
2. 需求分析、领域分析和交付规划最多三个并行执行。
3. 独立批判评审检查矛盾、证据缺口、假设和越权风险。
4. PM 综合用户可见回答，不暴露内部思维链。
5. 记忆整理器只生成候选记忆与资产补丁。

默认路由为 OpenAI `gpt-5.6-terra`、复杂升级 `gpt-5.6-sol`、DeepSeek `deepseek-v4-flash` 和 `deepseek-v4-pro`。没有密钥时系统明确进入 Demo 模式，不把模板结果标成真实推理。

## 4. 领域与版本模型

产品交付拆分固定为：

```text
Outcome -> Capability -> Epic -> WorkItem -> AcceptanceCriterion
```

每项提案携带 `baseVersion`。审批时如果正式基线已前进，提案进入 `stale`，返回 HTTP 409 并要求重新生成差异，禁止静默合并。批准会复制当前基线、应用用户选择的路径并创建新的不可变 `ArtifactVersion`。

记忆状态为 `candidate`、`confirmed`、`forgotten`、`superseded`。纠正不会物理删除旧记录，而是创建带 `supersedesId` 的新版本。

## 5. 安全模型

- 密码使用 Argon2id；管理员脚本创建临时密码并强制首次改密。
- 会话使用 HttpOnly、SameSite Cookie；生产要求 Secure Cookie 和至少 32 位随机会话密钥。
- 所有写接口执行代理感知的同源校验；登录失败按用户名和来源地址限流。
- RBAC 在服务端执行，前端隐藏按钮只用于体验，不作为安全边界。
- 网页摄取只允许 HTTP/HTTPS，拒绝凭据 URL、回环、链路本地和私网 DNS 结果，禁止自动重定向并限制时间和体积。
- 模型密钥只从环境变量或部署 Secret Manager 读取，不进入数据库、日志、浏览器或审计详情。
- 外部内容始终视为不可信资料，不能覆盖系统指令或直接改变正式资产。

## 6. 自进化 Gate

Prompt/流程改进只生成 `ImprovementProposal`。发布同时要求：结构合法、零越权、关键指标无回退、综合分至少提升 5%。只有管理员能发布或回滚。生产发布后需要观察至少 20 个真实运行，当前开发数据只演示审批状态机。

## 7. 部署与可观测性

`compose.yaml` 描述 Web、Worker、PostgreSQL/pgvector 和 MinIO。`infra/migrations/0001_init.sql` 是生产数据基线。正式上线前还必须完成并在容器环境验证：

- PostgreSQL repository 与 pg-boss worker 的实际接线和重启恢复；
- S3 原文件保存、文档解析、分块与嵌入流水线；
- 结构化日志、OpenTelemetry、模型成本与延迟采集；
- 每日备份、对象存储版本化和完整恢复演练；
- 使用真实 OpenAI/DeepSeek 凭据完成跨供应商运行和故障降级演练。
