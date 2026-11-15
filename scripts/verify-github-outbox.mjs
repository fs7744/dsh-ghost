#!/usr/bin/env node
/**
 * GitHub 出口验收：用真实的 HTTP 假服务器验证默认 fetch 路径（不注入 post）。
 *
 * 验三件事：请求形状对不对、幂等有没有效、失败会不会改状态。
 */
import { createServer } from 'node:http'
import { createGithubSink } from '../packages/sink-github/src/index.ts'

const posts = []
const server = createServer((request, response) => {
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    posts.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(raw || '{}') })
    // 第一次成功，第二次回 500 以验证失败路径
    if (posts.length === 2) {
      response.writeHead(500).end('boom')
      return
    }
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 9000 + posts.length }))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiBase = `http://127.0.0.1:${server.address().port}`

const failures = []
const sink = createGithubSink({ apiBase, token: 'tok-123', repo: 'fs7744/dsh-ghost' })

const shape = (id, number, text) => ({
  id,
  channel: { source: 'github', thread: `fs7744/dsh-ghost#${number}`, address: { repo: 'fs7744/dsh-ghost', number: String(number) } },
  text,
  kind: 'reply',
})

sink.send(shape('a', 42, '先看构建日志'))
sink.send(shape('b', 42, '这条会失败'))
sink.send(shape('a', 42, '重复投递不应再发'))

const result = await sink.flush()
server.close()

process.stdout.write(`投递    ${JSON.stringify(result)}\n`)
for (const entry of posts) process.stdout.write(`  服务端收到 ${entry.url} · ${entry.body.body} · auth=${entry.auth?.slice(0, 12)}…\n`)

const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${detail}`}\n`)
}

check('只发了两次（幂等生效）', posts.length === 2, `${posts.length} 次`)
check('URL 指向 issue 评论端点', posts[0]?.url === '/repos/fs7744/dsh-ghost/issues/42/comments')
check('带上 Bearer 令牌', (posts[0]?.auth ?? '').startsWith('Bearer tok-123'))
check('正文是排队时的第一条', posts[0]?.body.body === '先看构建日志')
check('成功记 sent / 失败留 pending', sink.status('a') === 'sent' && sink.status('b') === 'pending', `a=${sink.status('a')} b=${sink.status('b')}`)

process.stdout.write(`\n${failures.length === 0 ? 'GitHub 出口验收通过' : `${failures.length} 项失败`}\n`)
process.exit(failures.length === 0 ? 0 : 1)
