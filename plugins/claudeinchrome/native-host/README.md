# Native Host

Native Messaging Host、清单注册、卸载和 doctor 已实现在 `../host`，固定只允许
本插件 Chrome 扩展 ID。Host 不会由主程序自动注册；在标准 Plugin 接入和真实
Chrome 验收完成前，扩展显示 Native Host 未连接仍是预期的 fail-closed 状态。
