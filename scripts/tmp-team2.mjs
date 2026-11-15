import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = process.cwd()
let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  const agentId = created?.sessionId ?? ''
  const list = await transport.call('session/list', {}).catch(e => ({ err: String(e) }))
  console.log('LIST', JSON.stringify(list ?? null).slice(0, 1500))
  const proj = await transport.call('session/projections', { request: { sessionId: agentId } }).catch(e => ({ err: String(e) }))
  console.log('PROJ', JSON.stringify(proj ?? null).slice(0, 900))
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
