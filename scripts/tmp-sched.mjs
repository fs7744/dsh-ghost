import { boot, stop, login, createTransport } from './lib-driver.mjs'

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const catalog = await transport.call('schedule/catalog', {}).catch(e => ({ err: String(e) }))
  console.log('CATALOG', JSON.stringify(catalog ?? null).slice(0, 1200))
  const list = await transport.call('schedule/list', { request: {} }).catch(e => ({ err: String(e) }))
  console.log('LIST', JSON.stringify(list ?? null).slice(0, 600))
  const limits = await transport.call('schedule/deliveryLimits', {}).catch(e => ({ err: String(e) }))
  console.log('LIMITS', JSON.stringify(limits ?? null).slice(0, 400))
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
