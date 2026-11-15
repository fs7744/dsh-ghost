import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = process.cwd()
let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  console.log('CREATED', JSON.stringify(created ?? null).slice(0, 300))
  const agentId = created?.sessionId ?? ''
  const team = await transport.call('agentTeams/setEnabled', { agentId, enabled: true }).catch(e => ({ err: String(e) }))
  console.log('TEAM', JSON.stringify(team ?? null).slice(0, 300))
  const proj = await transport.call('session/projections', { request: { address: { kind: 'session', sessionId: agentId } } }).catch(e => ({ err: String(e) }))
  console.log('PROJ', JSON.stringify(proj ?? null).slice(0, 900))
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
