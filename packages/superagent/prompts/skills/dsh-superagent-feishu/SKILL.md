---
name: dsh-superagent-feishu
description: 处理飞书群 @ 提及触发的票，默认关闭，启用后才加载。
---

# dsh-superagent-feishu

按需加载：飞书源默认关闭，只有显式启用并配好密钥后才会进来。

声明式字段映射见 examples/sources.patch.yml；准入与答复流程见 playbooks/*.flow。
本技能不硬编码任何 token，也不复述流程步骤。
