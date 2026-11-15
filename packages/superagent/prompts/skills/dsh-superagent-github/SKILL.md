---
name: dsh-superagent-github
description: 处理 GitHub issue / PR / 评论触发的票，按 .flow 剧本走完并回写评论。
---

# dsh-superagent-github

按需加载本技能：当触发源是 github 且已建票时使用。

流程见 playbooks/admission.flow 与 playbooks/superagent.flow。
签名校验交给 source-github，归一化交给 source-hub，结果经 Outbox 回到原 issue。

不要在本文件里复述流程步骤；确定性步骤写成脚本，模型只读输出。
