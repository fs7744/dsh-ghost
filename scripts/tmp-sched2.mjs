import { boot, stop, login, createTransport } from './lib-driver.mjs'

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const created = await transport.call('session/create', { request: { cwd: process.cwd() } })
  const sessionId = created?.sessionId ?? ''
  // 试着建一个 1 分钟后的 cron 任务，target 指向当前会话
  const at = new Date(Date.now() + 60_000)
  const pad = (n) => String(n).padStart(2, '0')
  const expression = `${pad(at.getMinutes())} ${at.getHours()} * * *`
  const made = await transport.call('schedule/create', {
    request: {
      record: {
        id: 'test-playbook-sched',
        kind: 'cron',
        title: '测试剧本',
        prompt: '执行剧本 test-flow',
        expression,
        timeZone: 'Asia/Shanghai',
        scheduledAt: at.toISOString(),
      },
      target: { kind: 'session', sessionId },
      status: 'active',
    },
  }).catch(e => ({ err: String(e) }))
  console.log('CREATE', JSON.stringify(made ?? null).slice(0, 600))
  if (made?.id !== undefined || made?.task !== undefined) {
    const list = await transport.call('schedule/list', { request: {} })
    console.log('LIST', JSON.stringify(list ?? null).slice(0, 700))
    const ran = await transport.call('schedule/run', { request: { id: 'test-playbook-sched' } }).catch(e => ({ err: String(e) }))
    console.log('RUN', JSON.stringify(ran ?? null).slice(0, 400))
    const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 20 } })
    const records = page?.records ?? []
    console.log('RECORDS', records.length, JSON.stringify(records).slice(0, 400))
  }
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
