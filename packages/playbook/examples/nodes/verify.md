# 验证

跑仓库自己的检查，不要自创：

1. `npm run typecheck`
2. `npm test`
3. 若有 e2e：`npm run test:e2e`（没有 key 会自我跳过）

三条全绿才算通过。失败时把**第一条**失败的原始输出原样带回给模型，不要总结。
