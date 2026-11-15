/** 外部 agent（peer）：配置校验、CLI/HTTP/A2A 三种接法。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  buildA2ARequest, buildCliArgs, normalizePeers, parseA2AOutput, parseHttpOutput, runPeer, validatePeer,
} from '../src/index.ts'

test('配置校验：id、kind 与必填项都要对', () => {
  assert.deepEqual(validatePeer({ id: 'claude', label: 'Claude Code', kind: 'cli', command: 'claude' }), [])
  assert.deepEqual(validatePeer({ id: 'peer', label: '对端', kind: 'a2a', url: 'http://127.0.0.1:9000' }), [])
  assert.ok(validatePeer({ id: 'Bad Id', label: '', kind: 'x' }).length >= 3)
  assert.ok(validatePeer({ id: 'a', label: 'A', kind: 'http' }).some(problem => problem.includes('地址')))
  assert.ok(validatePeer({ id: 'a', label: 'A', kind: 'cli' }).some(problem => problem.includes('command')))
})

test('归一化：重复 id 只留一个，非法项给原因', () => {
  const result = normalizePeers([
    { id: 'a', label: 'A', kind: 'cli', command: 'a' },
    { id: 'a', label: 'A2', kind: 'cli', command: 'a2' },
    { id: 'b', label: '', kind: 'cli' },
  ])
  assert.equal(result.peers.length, 1)
  assert.equal(result.peers[0]?.label, 'A')
  assert.equal(result.errors.length, 1)
})

test('CLI 参数：{prompt} 占位优先，其次追加，最后 stdin', () => {
  const peer = { id: 'a', label: 'A', kind: 'cli' as const, command: 'x', args: ['-p', '{prompt}'] }
  assert.deepEqual(buildCliArgs(peer, 'hello').args, ['-p', 'hello'])
  const plain = { id: 'a', label: 'A', kind: 'cli' as const, command: 'x', args: ['exec'] }
  assert.deepEqual(buildCliArgs(plain, 'hello').args, ['exec', 'hello'])
  const stdinPeer = { ...plain, promptVia: 'stdin' as const }
  const built = buildCliArgs(stdinPeer, 'hello')
  assert.deepEqual(built.args, ['exec'])
  assert.equal(built.stdin, 'hello')
})

test('HTTP 输出：认几种常见字段', () => {
  assert.equal(parseHttpOutput({ output: 'x' }), 'x')
  assert.equal(parseHttpOutput({ reply: 'y' }), 'y')
  assert.equal(parseHttpOutput({ result: 'z' }), 'z')
  assert.equal(parseHttpOutput({ content: ['a', 'b'] }), 'a\nb')
  assert.equal(parseHttpOutput('纯文本'), '纯文本')
  assert.equal(parseHttpOutput({}), '')
})

test('A2A 输出：artifacts 与 status.message 都认', () => {
  const artifacts = { result: { artifacts: [{ parts: [{ text: '来自 artifact' }] }] } }
  assert.equal(parseA2AOutput(artifacts), '来自 artifact')
  const status = { result: { status: { message: { parts: [{ text: '来自 status' }] } } } }
  assert.equal(parseA2AOutput(status), '来自 status')
  const request = buildA2ARequest('做件事', '上下文')
  assert.equal(request.method, 'message/send')
  const params = request.params as { message: { parts: Array<{ text: string }> } }
  assert.match(params.message.parts[0]?.text ?? '', /做件事/)
  assert.match(params.message.parts[0]?.text ?? '', /上下文/)
})

test('真跑一个 cli peer（用 node 当假 agent）', async () => {
  const peer = {
    id: 'fake',
    label: '假 agent',
    kind: 'cli' as const,
    command: process.execPath,
    args: ['-e', 'process.stdout.write("收到:" + process.argv[1])', '{prompt}'],
  }
  const result = await runPeer(peer, '任务A', { timeoutMs: 20_000 })
  assert.equal(result.ok, true)
  assert.equal(result.output, '收到:任务A')
})

test('真跑一个 http peer（本地假服务）', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body) as { prompt?: string }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ output: `HTTP 收到:${parsed.prompt ?? ''}` }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  try {
    const result = await runPeer({
      id: 'http-peer', label: 'HTTP 对端', kind: 'http', url: `http://127.0.0.1:${port}/tasks`,
    }, '任务B', { timeoutMs: 20_000 })
    assert.equal(result.ok, true)
    assert.equal(result.output, 'HTTP 收到:任务B')
  } finally {
    server.close()
  }
})

test('peer 失败时给原因，不抛异常', async () => {
  const result = await runPeer({
    id: 'bad', label: '坏 peer', kind: 'http', url: 'http://127.0.0.1:1/none',
  }, 'x', { timeoutMs: 3000 })
  assert.equal(result.ok, false)
  assert.ok(result.error !== undefined && result.error.length > 0)
})
