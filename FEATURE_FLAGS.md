# Feature Flag 策略

Feature Flag 的唯一机器可读清单位于 `scripts/feature-policy.ts`。构建脚本、开发入口和 Vite 插件均通过 `resolveBuildFeatures()` 解析同一份策略，不允许各自维护默认列表。

## 支持级别

| 级别 | 用途 | 默认构建 | 显式启用条件 |
| --- | --- | --- | --- |
| `stable` | 已有固定验收覆盖、允许常规发布的能力 | 仅启用 `default: true` 的项目 | `FEATURE_<NAME>=1` |
| `experimental` | 接口或行为仍可能变化的开发能力 | 不启用 | `ALLOW_EXPERIMENTAL_FEATURES=1` 且 `FEATURE_<NAME>=1` |
| `internal` | 内部服务、部署拓扑、遥测或专用运行模式 | 不启用 | `ALLOW_INTERNAL_FEATURES=1` 且 `FEATURE_<NAME>=1` |

稳定项只有声明至少一个 `acceptance` 验收目标后才能进入默认集合。默认构建不会因为源码中存在 Flag 而自动开启实验或内部能力。

## 依赖、冲突和覆盖

- `requires` 声明必须同时启用的 Feature Flag。
- `conflicts` 声明不能同时启用的 Feature Flag。
- `FEATURE_<NAME>=0` 可显式关闭稳定默认项，用于选择与其冲突的实验方案。
- 未登记的 Flag、非 `0`/`1` 值、缺失依赖、冲突组合或未授权的实验/内部能力都会在开发或构建启动时直接报错退出。

PowerShell 示例：

```powershell
$env:ALLOW_EXPERIMENTAL_FEATURES = '1'
$env:FEATURE_EXTRACT_MEMORIES = '1'
$env:FEATURE_POOR = '0'
bun run build
```

内部依赖组合示例：

```powershell
$env:ALLOW_INTERNAL_FEATURES = '1'
$env:FEATURE_UDS_INBOX = '1'
$env:FEATURE_LAN_PIPES = '1'
bun run build
```

`scripts/validation/feature-flags.ts` 会扫描 `src` 与 `packages` 中的静态 `feature('NAME')` 调用，检查分类完整性、默认稳定项验收覆盖、依赖目标、冲突逻辑、授权门槛以及显式启停行为，并由唯一总入口 `bun run verify` 执行。
