# Claude Code Best

这是一个面向 OpenAI-compatible API 与本地模型的 Claude Code 衍生发行版。

本 README 只记录本项目的自定义行为和与 Claude Code 官方不一致的边界。未特别说明的交互、命令和工作流，请直接参考 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)。

## 版本与文档边界

- 项目发行版本：`2.1.116`
- 官方对照基线：Claude Code `2.1.220`，以[官方 Changelog](https://code.claude.com/docs/en/changelog)为准。
- 本项目不追踪或复述官方已有且行为一致的功能；升级官方版本时，只补充新增差异或重新评估现有差异。

## 与当前官方版本的主要差异

以下是以官方 `2.1.220` 为基线的产品差异，不应把上游功能说明误认为本项目能力。

- **模型与登录**：官方的 Anthropic 登录、官方模型、组织默认/限制模型、Claude API Provider 与相关云端模型能力不适用。本项目只从 `models.json` 加载 OpenAI-compatible 模型；模型 Profile 静态声明，不做服务端模型发现或自动模型替换。
- **云端与远程产品**：官方的 Web/Desktop/Mobile、Remote Control、GitHub App、Cloud Code Review、Routines、Channels、Artifacts、语音与账户/用量产品均不提供。本项目也不包含官方自动更新、安装器或远端遥测。
- **插件与浏览器**：官方插件市场、远端安装/更新和插件自动重命名不提供。主程序不提供 Chrome 控制；Chrome 能力只能来自显式加载的本地 `claudeinchrome` 插件。该插件的 MCP、Skill 与 Native Host 尚未迁移和验收，当前不可用。
- **Sandbox**：Windows 上启用 Sandbox 时，Shell 会在 Windows Sandbox VM 内执行，默认只映射启动工作区和只读 Shell 运行时，且固定断网、不传递用户主目录或凭据。`failIfUnavailable`、`excludedCommands` 与 `allowUnsandboxedCommands` 保持上层语义；Windows 不能精确落实域名白名单、代理和目录内文件 allow/deny 规则，配置这些规则时会 fail-closed，而不会回退宿主执行。
- **会话路径**：官方 `/cd` 可迁移会话；本项目有意保持临时 cwd 语义，只改变主会话后续工具的当前目录，不迁移项目身份、会话存储、权限根、配置或扩展作用域。
- **Agent、Hook、MCP 与 Skill**：本地 Agent、后台任务、Hook、Plugin、Skill 与 MCP 生命周期第三阶段已经按官方对照基线验收；嵌套 Skill 使用相对启动项目根的限定名，连续 inline Skill 可在同一条输入中组合。`/cd` 的临时 cwd、OpenAI-compatible Provider、本地安全增强和不提供云端 Agent 产品仍是明确差异。本地 `/mcp login`/`logout` 仅管理用户配置的 MCP OAuth 凭据。

## 运行时边界

### 网络能力边界

本项目只支持由 `models.json` 配置的 OpenAI-compatible Chat Completions 服务，包括本地 llama.cpp 和兼容该协议的远端服务。

- 不提供 Anthropic 官方网络 Provider、账号登录、OAuth、自动更新或原生安装流程。
- `@anthropic-ai/sdk` 仅保留为本地消息、工具调用、流事件和 Usage 的类型兼容层；它不是 Anthropic 网络连接的入口。
- 不提供 ChatGPT/Codex OAuth、Anthropic MCP Registry 预取、远端插件市场、远端插件下载或插件自动更新。
- 对不兼容 Chat Completions 的端点，直接给出兼容性错误；不会静默删除字段、切换 Provider 或进入供应商专用适配分支。

用户自行配置的模型端点、MCP、Hook 以及本地插件仍可访问其对应的外部服务。

Hook 可在 `PreToolUse` 中配置 `{"type":"mcp","tool":"mcp__server__tool","input":{...}}`，但只会调用当前会话已加载的 MCP Tool。该调用仍执行目标输入 Schema、现有工具权限和超时检查；拒绝、认证失败或执行失败会阻止原工具继续运行，不会借 Hook 绕过审批。

Hook command 的 `args` 会保持 argv 参数边界。启用 Sandbox 时不会回退到宿主直接执行：POSIX 进入 Sandbox 包装，Windows 上无法安全映射任意宿主可执行文件时会明确失败。

远程功能开关不参与运行行为；本地固定策略见 [`scripts/feature-policy.ts`](scripts/feature-policy.ts)，可用环境变量的完整清单见 [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)。

## 模型配置

模型配置文件为 `~/.claude/models.json`。模型名必须唯一；多个模型可以共用同一个 `baseUrl`。`/model` 只在此列表中切换模型。

```json
{
  "defaultModel": "Qwen3.5-9B-Q6_K",
  "models": [
    {
      "model": "Qwen3.5-9B-Q6_K",
      "displayName": "Local Qwen",
      "baseUrl": "http://127.0.0.1:8080/v1"
    },
    {
      "model": "deepseek-v4-flash",
      "displayName": "DeepSeek Flash",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "profile": {
        "reasoning": {
          "enabledByDefault": false
        }
      }
    }
  ]
}
```

密钥优先从模型的 `apiKeyEnv` 指定环境变量读取；未设置时可使用本地初始化保存的配置密钥。密钥不会写入诊断日志。

### 静态模型 Profile

模型能力由模型 ID 的静态 Profile 决定，包括上下文窗口、最大输出 Token、推理参数、Prompt Cache、价格以及工具调用字段。项目不会通过模型名称猜测能力，也不会在运行时进行能力探测。

- 已知模型使用代码中的显式 Profile。
- 未知模型使用 Qwen 派生的默认 Profile，并提示建议补充专用配置。
- `models.json` 中的 `profile` 可覆盖默认 Profile，例如关闭 DeepSeek 的默认推理模式。
- llama.cpp 等端点若不接受对象形式的 `tool_choice`，会按其显式兼容配置发送字符串形式；不增加供应商专用协议分支。

模型请求失败时，诊断日志仅记录脱敏后的端点、模型、请求字段摘要、状态码和重试信息，不记录 API Key、OAuth Token 或完整 Prompt。

## 本地模型与 Windows Shell

本地 llama.cpp 的地址和模型名完全由 `models.json` 决定。上下文窗口必须同时满足模型 Profile 与 llama.cpp 实际启动时的 KV Cache 容量；服务端出现 “failed to find free space in the KV cache” 时，应降低请求上下文、输出上限或增大服务端上下文配置。

Windows 下 Bash 与 PowerShell 会按优先级探测可用实现。Bash 工具运行的是 Bash 语法，不应把 Windows `type`、`dir` 等 PowerShell/cmd 命令当作 Bash 命令使用；路径含空格、Unicode 或盘符时应使用与当前 Shell 匹配的引用和路径格式。

### Windows Sandbox

`sandbox.enabled: true` 时，受保护的 Bash 与 PowerShell 在 Windows Sandbox VM 中执行；VM 在首条受保护命令时启动，Bash 与 PowerShell 共用同一会话，取消命令或正常退出 CLI 都会关闭该会话。来宾只获得启动工作区的可写映射、私有控制目录和只读 Shell 运行时；网络、麦克风输入、剪贴板和 vGPU 均禁用，用户主目录、`.claude` 凭据和系统根目录不会映射或通过请求环境传入。

Windows Sandbox 不能精确执行域名白名单、代理或映射目录内的 `allowRead`/`denyRead`、`allowWrite`/`denyWrite` 规则。配置这些规则时 Sandbox 会拒绝启用，绝不会无提示回退到宿主命令。卷根、UNC、符号链接或 Junction 映射同样会被拒绝。

命令权限决策顺序固定为：硬安全拒绝、显式 deny、不可绕过安全审批、显式 ask、精确 allow、受约束模式/只读自动允许、默认 ask。工具级通配规则不能覆盖硬安全结果。

## 会话与文件工具差异

`/cd` 只临时改变主会话后续工具使用的当前工作目录，不提供官方的跨项目会话迁移：

- 启动项目根、Session ID、Transcript/Resume、权限根、Settings、CLAUDE.md、Hook、Skill、Plugin、MCP、Memory、Plan 和 Checkpoint 作用域保持不变。
- `/cd` 不传播给子 Agent，子 Agent 的 cwd 变化也不会回写主会话。
- `/clear` 和进程重启恢复到启动项目目录。
- 无参数只显示当前 cwd；路径无效或切换失败时保留原 cwd。

Bash/PowerShell 命令中的 `cd` 属于 Shell cwd 持久化规则，不会触发项目身份或会话迁移。

### Agent 与本地后台任务

- 普通 Agent 默认后台运行；需要立即消费结果时可显式前台运行。Agent、Team、Shell、Workflow、MCP Monitor 和本地后台 Session 使用统一生命周期，等待权限、空闲、完成、失败、停止和取消可区分，终态不可被恢复或迟到事件覆盖。
- Agent cwd 与主会话隔离，worktree 使用独立目录。嵌套 Agent 默认最大深度 2、会话总数 50、并发 8、累计 Token 1,000,000；超限明确失败，取消向真实子树传播。
- `/fork` 创建拥有独立 Session、Transcript 和进程的后台会话，可通过 `status`、`attach`、`detach`、`resume` 和 `kill` 管理；`/subtask` 继承当前上下文，结果、通知与预算仍归当前会话。
- Shell 后台化会保留原进程、Tool Use ID、输出、退出码和取消链；MCP Monitor 使用同一任务契约。普通 MCP Tool 默认运行 30 秒后转入统一后台任务，保留 Task ID、进度、结果文件、取消和原始超时；不会在可能已经产生副作用后自动重放。
- 交互式后台 Agent 的权限请求返回主会话并标明来源；headless/stream-json 安全拒绝无法交互审批的请求。启用 partial messages 时，嵌套文本和推理事件携带父 Tool Use ID 与 Agent ID。
- Agent 最终报告与 Shell 交互提示中的间接内容会标记为 `untrusted-content` 并转义，不能伪造运行时控制、任务终态或权限结果。

文件工具针对本地模型的重复失败增加确定性保护：同一轮中同一文件工具、操作和规范化路径连续失败两次后，后续相同调用会被阻止并要求模型先读取错误、调整参数或改用其他操作，避免无限重试。创建后立即修改的流程会保留文件版本校验；遇到外部修改错误时应先重新读取文件。

大文件写入支持自动分块与截断恢复。恢复块有确定的大小上限；模型没有按协议分块时，工具会使用确定性方案继续，而不是无限要求模型重发完整内容。

## 主题、插件与安全边界

主题只有两类来源：内置主题，以及 `~/.claude/themes/*.json`。主题文件在启动时读取；外部修改后重启生效。不提供交互编辑、热更新或插件主题安装。

插件仅支持已安装的本地插件。依赖的 SemVer 范围在加载时校验，缺失、禁用或版本不满足会安全降级；`/reload-plugins` 会重新加载并裁剪已移除的活动组件。没有远端市场、下载、原生安装、CLI 自更新或插件自动更新。

### 本地 Chrome 扩展

Chrome 集成边界位于 [`plugins/claudeinchrome`](plugins/claudeinchrome)，目标
链路为“主程序标准插件加载器 → 插件 MCP/Skill → 插件 Native Host → Chrome
扩展 → Chrome”。主程序不会自动注入 Chrome MCP，也不提供 `--chrome`、`/chrome`
或内置 Chrome Skill。

Manifest V3 扩展源码位于
[`plugins/claudeinchrome/chrome-extension`](plugins/claudeinchrome/chrome-extension)，
固定扩展 ID 为 `dlpofjonbnceelbmpelkfblmnghclmkm`。目前仅完成插件骨架和扩展
归位；MCP、Skill 与 Native Host 仍待迁移和验收，因此当前不能通过该插件控制
Chrome。进度与完成条件见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)。

## 构建与验证

```powershell
bun install
bun run typecheck
bun run lint
bun run build
bun run build:node
bun run build:exe
bun run verify
```

支持三条构建链：

- Bun bundle：开发和 Bun 运行时产物。
- Vite/Rollup Node bundle：Node 兼容分发产物。
- Bun standalone EXE：Windows standalone EXE 单文件 `claude.exe`。

项目保持 TypeScript + Bun 实现，不以 Rust 或其他平台原生语言重写 CLI。`claude.exe` 是包含 Bun Runtime 的 standalone 产物；它的目标是免安装运行时分发，而不是追随官方的原生二进制实现或安装/自更新机制。

`bun run verify` 是唯一的项目验证入口，覆盖依赖锁定、类型、Biome、适用构建、CLI `--version`/启动冒烟、源码级轻量验证，以及可用本地模型的单轮模型和工具调用。它不依赖付费云模型，也不引入第二套测试框架。

## 项目文档

- [开发计划与差异基线](DEVELOPMENT_PLAN.md)
- [环境变量](ENVIRONMENT_VARIABLES.md)
- [Feature Flag 策略](FEATURE_FLAGS.md)
- [依赖审计](DEPENDENCY_AUDIT.md)
- [Anthropic SDK 类型兼容边界](ANTHROPIC_SDK_COMPATIBILITY.md)
