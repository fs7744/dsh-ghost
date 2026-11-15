/**
 * 用户自定义来源示例：任意 IM / 自建系统的 webhook → 归一化事件。
 *
 * 契约：默认导出一个函数，接收 { headers, rawBody, body, event, options }，
 * 返回 0~n 条 { source, threadId, text, human?, addressed?, actor?, url?, channel? }。
 * 文件路径写进 profile 的 `sources[].mapper` 即可，不需要改项目代码。
 */
export default function map({ body, options }) {
  const payload = body ?? {}
  if (payload.type !== 'im.message') return []
  const room = String(payload.room ?? 'general')
  const text = String(payload.text ?? '')
  if (text === '') return []
  const mention = String(options.mention ?? '@ghost')
  return [{
    source: 'my-im',
    threadId: `im:${room}:${String(payload.thread ?? 'main')}`,
    text,
    human: payload.from?.bot !== true,
    addressed: text.includes(mention),
    actor: String(payload.from?.name ?? 'unknown'),
    channel: {
      source: 'my-im',
      thread: `im:${room}`,
      address: { room },
    },
  }]
}
