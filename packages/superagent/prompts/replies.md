# 答复说明（按需）

流程见 playbooks/replies.flow。四种用途：acknowledgement / answer / result / attention。

- result 只在票 ready 或已完成后排队；未就绪就继续等，不把 progress 改标签发出去。
- Outbox 按确定性 id 幂等，重复 flush 不刷屏。
- 回复排到消息发起的会话，靠归一化事件里的 channel 定位。
- 向人提问要命中票当前打开的 attention 问题，不能用旧问题。
