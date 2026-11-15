import { boot, stop, login, createTransport } from './lib-driver.mjs'

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const catalog = await transport.call('permissionPresets/catalog', {}).catch(e => ({ err: String(e) }))
  console.log('CATALOG', JSON.stringify(catalog ?? null).slice(0, 900))
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
