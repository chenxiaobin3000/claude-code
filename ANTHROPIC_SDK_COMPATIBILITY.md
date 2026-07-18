# Anthropic SDK 内部兼容边界

## 目的

本项目的模型请求主路径固定为 OpenAI 及 OpenAI-compatible 协议，不提供 Anthropic
账号登录、账号鉴权或官方模型直连。`@anthropic-ai/sdk` 仍作为内部消息、工具、流事件
和 Usage 数据结构的兼容层保留。

保留 SDK 类型不表示恢复 Anthropic Provider。禁止仅根据文件名、`claude` 命名或 SDK
导入删除代码；删除前必须证明代码只服务已移除的 Provider，且不承担下述共享职责。

## 实际调用范围

### 消息和 Content Block

内部消息继续使用 SDK 的 `MessageParam`、`ContentBlock`、`TextBlock`、图片、Thinking、
Redacted Thinking、Tool Use 和 Tool Result 类型。它们用于：

- `src/utils/messages.ts` 与 `src/utils/messages/mappers.ts`：消息规范化、Tool Use/Result
  配对、Thinking 识别、会话处理。
- `src/utils/attachments.ts`：附件转换和消息注入。
- `src/components/messages/`：文本、Thinking、工具请求和工具结果渲染。
- `src/services/compact/`：上下文压缩与消息重组。
- `src/services/api/openai/`：把内部消息转换为 OpenAI 请求。

核心转换入口是
`packages/@ant/model-provider/src/shared/openaiConvertMessages.ts`。它负责 System、User、
Assistant、图片、Thinking、Tool Use 和 Tool Result 转换；未知或服务端专属 Block 安全
跳过，不把 Provider 私有字段直接发送到 OpenAI-compatible 网关。

### 工具兼容

`packages/@ant/model-provider/src/shared/openaiConvertTools.ts` 将 SDK 的 Tool Schema 和
Tool Choice 转换为 OpenAI Function Calling 格式，并递归清理兼容网关不支持的 JSON
Schema 字段。Tool Call ID、Tool Result ID、并行工具调用和错误结果由以下模块继续使用：

- `src/services/tools/`
- `src/utils/toolSchemaCache.ts`
- `src/utils/api.ts`
- `src/Tool.ts`
- `src/services/mcp/client.ts`

### 流事件兼容

`packages/@ant/model-provider/src/shared/openaiStreamAdapter.ts` 把 OpenAI Chunk 转换为内部
使用的 `BetaRawMessageStreamEvent`，覆盖：

- `message_start`、`message_delta`、`message_stop`
- `content_block_start`、`content_block_delta`、`content_block_stop`
- 文本增量、Thinking 增量、Tool Call JSON 参数增量
- `length`、`tool_calls` 等结束原因

主调用位于 `src/services/api/openai/index.ts`，结果继续交给
`src/services/tools/StreamingToolExecutor.ts` 和 UI/会话处理层。

### Usage 和 Token

OpenAI Usage 被映射为内部兼容字段：

- `input_tokens`
- `output_tokens`
- `cache_read_input_tokens`
- `cache_creation_input_tokens`

主要实现位于 `openaiStreamAdapter.ts`、`src/services/model/usage.ts`、
`src/utils/tokens.ts` 和 `src/cost-tracker.ts`。`src/services/tokenEstimation.ts` 当前只做
本地确定性粗略估算，不再调用 Anthropic、Vertex 或 Foundry 的远程 Token API。

## 保留、删除和审计规则

必须保留：

- 根包、`packages/@ant/model-provider` 和 `packages/workflow-engine` 中精确锁定为
  `0.81.0` 的 `@anthropic-ai/sdk` 兼容依赖；升级必须三处同步并更新 `bun.lock`。
- `openaiConvertMessages.ts`、`openaiConvertTools.ts`、`openaiStreamAdapter.ts`。
- Message、Tool、Usage 的共享类型和处理逻辑。
- UI、MCP、会话存储、上下文压缩对上述类型的消费代码。

允许删除：

- Anthropic/Bedrock/Vertex/Foundry/Gemini/Grok 的独立传输 Client。
- Provider 专属账号、密钥、OAuth、云凭据、区域和模型部署配置。
- 只服务已移除远程接口且主路径已有替代实现的请求代码。

必须单独审计：

- 同时包含 Provider 请求和共享消息处理的文件。
- 只以类型形式导入 `@anthropic-ai/sdk` 的文件。
- 名称包含 `Anthropic` 或 `Claude`，但被 OpenAI 主路径消费的代码。
- Tool、Thinking、Usage 或 Content Block 的标准化代码。

### 运行时导入白名单

SDK 导入默认必须使用 `import type`。仅允许以下错误类作为运行时值导入，它们用于本地
中断、连接错误归一化和重试控制，不会创建 Anthropic Client 或发起网络请求：

- `APIUserAbortError`
- `APIConnectionError`
- `APIConnectionTimeoutError`
- `APIError`

不得增加默认导入、命名空间导入、裸副作用导入、`require()`、运行时动态导入或其他
SDK 运行时符号。`new Anthropic()` 以及任何 Anthropic SDK Client 初始化均为边界违规。
新增运行时符号前必须证明它只承担本地协议兼容职责，并同时更新本文件和
`scripts/validation/sdk-compat-boundary.ts` 的显式白名单。

## 历史删除复核

以初始提交 `309a8a8` 为基线，对 `ad7c94e`、`a721dc9` 和 `8e188da` 进行复核：

| 删除内容 | 原职责 | 当前替代 | 结论 |
| --- | --- | --- | --- |
| Anthropic Client 与 API Key 验证 | 官方模型请求和鉴权 | OpenAI Client 请求时验证 | 不恢复 |
| Vertex/Foundry Client 与云鉴权 | 云 Provider 传输 | OpenAI-compatible 主路径 | 不恢复 |
| 远程 Token Count | Anthropic/Vertex 请求 | 本地粗略估算 | 不恢复 |
| Gemini/Grok 转换和入口 | 已移除 Provider | 无 | 不恢复 |
| OpenAI 消息、工具和流适配 | 共享兼容层 | 当前仍在使用 | 必须保留 |

审计时，初始版本有 145 个文件引用 SDK；2026-07-19 当前工作树的 `src` 与 `packages`
共有 142 个引用文件。共享 OpenAI 转换文件没有被删除。引用数量仅作为带日期的审计
记录，不作为防回归阈值；正常重构可以改变数量，边界脚本检查的是职责、导出、调用链
和运行时导入种类。

## 验证

- `scripts/validation/sdk-compat-boundary.ts`：检查依赖、关键文件、导出和运行时调用链。
- `scripts/validation/message-conversion.ts`：验证消息、图片、Thinking、工具结果和 Tool
  Schema 转换。
- `scripts/validation/openai-stream.ts`：验证事件顺序、Tool JSON 分片、结束原因和 Usage。
- `scripts/validation/tool-permissions.ts`：验证工具权限共享逻辑。

`sdk-compat-boundary.ts` 负责证明本地兼容层仍然存在并限制 SDK 运行时符号；
`anthropic-boundary.ts` 负责禁止 Anthropic 域名、凭据、账号接口和模型 Provider。前者不把
SDK 类型视为网络能力，后者也不得通过删除共享类型来消除网络标记。

运行：

```powershell
bun run verify -- --ci
```

删除兼容代码前，还应使用以下命令重新生成引用清单并检查历史差异：

```powershell
rg -n "@anthropic-ai/sdk" src packages
git diff --name-status 309a8a8..HEAD -- src packages
```

## SDK 升级清单

升级 `@anthropic-ai/sdk` 时必须一次完成：

1. 同步修改根包、model-provider 和 workflow-engine 的精确版本并更新 `bun.lock`。
2. 复核所有 `resources/*`、`resources/beta/*` 和 `error` 深层导入仍可解析。
3. 检查 Message、Content Block、Tool、Thinking、Stop Reason 和 Usage 类型差异。
4. 运行消息转换、工具转换和 OpenAI 流适配轻量验证。
5. 运行 `bun run verify -- --ci`，再使用本地 OpenAI-compatible 模型运行普通
   `bun run verify`，覆盖三类产物的真实请求和工具调用。
6. 不得以升级为由引入 Anthropic Client、凭据、域名、远程 Token Count 或 Provider 分支。
