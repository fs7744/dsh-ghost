# 执行器侧交接（按需）

流程见 playbooks/handoff.flow。收到票 {{ticket}} / 派活 {{assignment}} 的交接后：

- 先读交接注记再动手；范围外的消息用 orchestrator_trigger_handback 交回。
- 交接不改变 Mandate，授权边界以建票时为准。
- 对交接里没有的事实不要脑补，向主会话请求注记。
