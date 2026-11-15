// SPDX-License-Identifier: Apache-2.0
/**
 * 示例适配器：静态模型列表 + 回显，零网络零 DOM。
 * 用户插件照这个形状实现 3 个方法即可，不 import 任何 @deepseek-ai/* 包。
 * 可以直接复制本文件到自己的仓库，把 import 改成包名。
 */
import type { ChatRequest, ChatResponse, ModelAdapter, ModelInfo } from '../src/index.ts'

/** 宿主会读这个字段做契约版本兼容校验。 */
export const contractVersion = '1.0.0'

const MODELS: readonly ModelInfo[] = [
  { id: 'echo-1', name: 'Echo Small', contextWindow: 8192, maxTokens: 2048 },
  { id: 'echo-2', name: 'Echo Large', contextWindow: 32768, maxTokens: 4096, reasoningEfforts: ['low', 'medium', 'high'] },
]

export function createEchoAdapter(): ModelAdapter {
  return {
    listModels: () => MODELS,
    chat: (request: ChatRequest): ChatResponse => {
      const last = [...request.messages].reverse().find(message => message.role === 'user')
      return { content: `ECHO:${last?.content ?? ''}`, finishReason: 'stop' }
    },
    close: () => {},
  }
}
