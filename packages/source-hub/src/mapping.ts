/**
 * 声明式映射引擎：不写一行代码就能接入任意 JSON webhook。
 *
 * 模板语法：`{{a.b}}` 取 body 的嵌套字段，`{{headers.x-foo}}` 取请求头，`{{event}}` 取事件名。
 * 取不到渲染成空串；对象渲染成 JSON。字段名与路径全部由用户配置决定。
 */
import type { GenericMapping, NormalizedEvent, SourceRequest } from './types.ts'

/** 按点路径取嵌套字段。 */
export function getPath(value: unknown, path: string): unknown {
  if (path === '') return value
  let current: unknown = value
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** 渲染一个模板字符串。 */
export function render(template: string, request: SourceRequest): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_all, expression: string) => {
    const path = expression.trim()
    let value: unknown
    if (path === 'event') value = request.event ?? ''
    else if (path.startsWith('headers.')) value = request.headers[path.slice('headers.'.length).toLowerCase()]
    else value = getPath(request.body, path)
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}

/** 事件名过滤与 where 条件。 */
export function matches(mapping: GenericMapping, request: SourceRequest): boolean {
  const event = mapping.eventHeader === undefined ? request.event : request.headers[mapping.eventHeader.toLowerCase()]
  if (mapping.events !== undefined && mapping.events.length > 0) {
    if (event === undefined || !mapping.events.includes(event)) return false
  }
  for (const condition of mapping.where ?? []) {
    const value = getPath(request.body, condition.path)
    if (condition.exists === true && (value === undefined || value === null)) return false
    if (condition.exists === false && value !== undefined && value !== null) return false
    if (condition.equals !== undefined && String(value ?? '') !== condition.equals) return false
  }
  return true
}

/** 按配置产出归一化事件；正文或线程键为空则不产出。 */
export function applyMapping(mapping: GenericMapping, request: SourceRequest, sourceId: string): NormalizedEvent[] {
  if (!matches(mapping, request)) return []
  const fields = mapping.fields
  const text = render(fields.text, request)
  const threadId = render(fields.threadId, request)
  if (text.trim() === '' || threadId === '') return []

  const event: NormalizedEvent = {
    source: fields.source === undefined ? sourceId : render(fields.source, request),
    threadId,
    text,
  }
  if (fields.actor !== undefined) event.actor = render(fields.actor, request)
  if (fields.url !== undefined) event.url = render(fields.url, request)
  if (fields.human !== undefined) event.human = render(fields.human, request).toLowerCase() === 'true'
  if (fields.addressed?.contains !== undefined) {
    const lower = text.toLowerCase()
    event.addressed = fields.addressed.contains.some(alias => lower.includes(alias.toLowerCase()))
  }
  if (fields.channel !== undefined) {
    const address: Record<string, string> = {}
    for (const [key, template] of Object.entries(fields.channel.address)) address[key] = render(template, request)
    event.channel = {
      source: fields.channel.source === undefined ? sourceId : render(fields.channel.source, request),
      thread: render(fields.channel.thread, request),
      address,
    }
  }
  return [event]
}
