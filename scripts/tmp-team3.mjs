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
  const proj = await transport.call('session/projections', { request: { sessionId: agentId } })
  const values = proj?.values ?? {}
  console.log('AGENT_TEAM', JSON.stringify(values.agentTeam ?? null))
  console.log('SUBAGENT_CATALOG', JSON.stringify(values.subagentCatalog ?? null))
  console.log('SUBAGENT', JSON.stringify(values.subagent ?? null))
  console.log('PERMISSIONS', JSON.stringify(values.permissions ?? null))
  console.log('SESSION_LIST_META', JSON.stringify(values.sessionListMetadata ?? null).slice(0, 400))
  // 开团队模式后再看一次投影
  await transport.call('agentTeams/setEnabled', { agentId, enabled: true }).catch(e => console.log('team err', String(e)))
  const proj2 = await transport.call('session/projections', { request: { sessionId: agentId } })
  console.log('AGENT_TEAM_AFTER', JSON.stringify(proj2?.values?.agentTeam ?? null))
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
