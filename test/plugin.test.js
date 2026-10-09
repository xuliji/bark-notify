/**
 * Behaviour tests for @local/bark-notify.
 *
 * Every test drives the plugin through a stub Cordis context and a real
 * localhost HTTP server standing in for the Bark API, so the assertions cover
 * the decision AND the request that decision produces.
 *
 * Run with `npm test` (or `node --test`).
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  abortCauseText,
  apply,
  isSubagent,
  resolveSettings,
  turnOutcome,
} from '../plugin.js'

/** A stub plugin context recording listeners, logs, and disposers. */
function fakeContext() {
  const handlers = new Map()
  const disposers = []
  const logs = []
  return {
    logs,
    on(name, handler) {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
    effect(setup) {
      disposers.push(setup())
    },
    get() {
      return undefined
    },
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      debug: (message) => logs.push(['debug', message]),
    },
    emit(name, ...args) {
      return handlers.get(name)?.(...args)
    },
    dispose() {
      for (const disposer of disposers) disposer()
    },
    /** Whether any recorded debug/info log line contains the fragment. */
    logged(fragment) {
      return logs.some(([, message]) => message.includes(fragment))
    },
  }
}

/** A local stand-in for the Bark API, recording every pushed payload. */
async function barkServer() {
  const received = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => {
      text += chunk
    })
    request.on('end', () => {
      received.push({ url: request.url, body: JSON.parse(text) })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 200, message: 'ok' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    received,
    serverUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** Wait until the predicate holds, or fail after `timeoutMs`. */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the expected pushes')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** The session shape the plugin reads: only `header` matters here. */
const sessionOf = (header = {}) => ({ header })

/** Wake the agent that owns `session` and let it settle idle. */
function finishRun(ctx, agent, reason) {
  const session = agent.session
  ctx.emit('agent/status', { agent, status: 'running' })
  if (reason !== undefined) ctx.emit('session/event', session, { type: 'turn/end', data: { reason } })
  ctx.emit('agent/status', { agent, status: 'idle' })
}

test('resolveSettings applies defaults and rejects malformed fields', () => {
  const defaults = resolveSettings(undefined)
  assert.equal(defaults.serverUrl, 'https://api.day.app')
  assert.equal(defaults.notifyOnAbort, false)
  assert.equal(defaults.settleMs, 1500)

  const custom = resolveSettings({
    serverUrl: 'https://bark.example.com///',
    deviceKey: '  key  ',
    notifyOnAbort: true,
    notifyOnFinish: 'yes',
    settleMs: -1,
    level: 'TimeSensitive',
    unknown: 'ignored',
  })
  assert.equal(custom.serverUrl, 'https://bark.example.com')
  assert.equal(custom.deviceKey, 'key')
  assert.equal(custom.notifyOnAbort, true)
  assert.equal(custom.notifyOnFinish, true, 'a non-boolean falls back to the default')
  assert.equal(custom.settleMs, 1500, 'a negative delay falls back to the default')
  assert.equal(custom.level, 'timeSensitive')
})

test('isSubagent recognises delegated children but not user forks', () => {
  assert.equal(isSubagent({ session: sessionOf({ origin: 'subagent', parentSession: 'session-a', delegationDepth: 1 }) }), true)
  assert.equal(isSubagent({ session: sessionOf({ parentSession: 'session-a', delegationDepth: 1 }) }), true)
  assert.equal(isSubagent({ session: sessionOf({}) }), false)
  assert.equal(isSubagent({ session: sessionOf({ parentSession: 'session-a' }) }), false, 'SessionController.fork writes parentSession only')
  assert.equal(isSubagent(undefined), false)
})

test('turnOutcome mirrors the chat UI classification', () => {
  assert.equal(turnOutcome({ kind: 'completed' }), 'finished')
  assert.equal(turnOutcome({ kind: 'blocked' }), 'finished')
  assert.equal(turnOutcome({ kind: 'max-tokens' }), 'finished')
  assert.equal(turnOutcome({ kind: 'aborted', reason: { kind: 'user' } }), 'aborted')
  assert.equal(turnOutcome({ kind: 'error', error: {} }), 'error')
  assert.equal(turnOutcome(undefined), 'none')
})

test('abortCauseText names the cancelling authority', () => {
  assert.equal(abortCauseText({ reason: { kind: 'user' } }), '运行已被手动中止')
  assert.equal(abortCauseText({ reason: { kind: 'parent' } }), '运行已被上级 Agent 中止')
  assert.equal(abortCauseText({ reason: { kind: 'disposed' } }), '会话已关闭，运行被中止')
  assert.equal(abortCauseText({ reason: { kind: 'hook', reason: 'policy' } }), '运行被 hook 中止：policy')
  assert.equal(abortCauseText({ reason: { kind: 'hook' } }), '运行被 hook 中止')
  assert.equal(abortCauseText(undefined), '运行已中止')
})

test('a completed turn pushes exactly one finish notification', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  finishRun(ctx, agent, { kind: 'completed' })
  await waitFor(() => bark.received.length === 1)

  assert.equal(bark.received[0].url, '/push')
  assert.equal(bark.received[0].body.title, '✅ 任务完成')
  assert.match(bark.received[0].body.body, /Agent 本轮运行已结束/)
})

test('a manually aborted turn pushes nothing by default', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  finishRun(ctx, agent, { kind: 'aborted', reason: { kind: 'user' } })
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.deepEqual(bark.received, [])
  assert.ok(ctx.logged('finish push skipped'), 'the skip is logged for diagnostics')
})

test('every cancel authority suppresses the finish push', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  for (const cause of [{ kind: 'user' }, { kind: 'parent' }, { kind: 'hook', reason: 'policy' }, { kind: 'disposed' }]) {
    const ctx = fakeContext()
    apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })
    finishRun(ctx, { id: `session-${cause.kind}aaaaaaa`, session: sessionOf() }, { kind: 'aborted', reason: cause })
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(bark.received, [])
})

test('notifyOnAbort opts back in with a distinct notification', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0, notifyOnAbort: true })

  finishRun(ctx, { id: 'session-abcdef123456', session: sessionOf() }, { kind: 'aborted', reason: { kind: 'user' } })
  await waitFor(() => bark.received.length === 1)

  assert.equal(bark.received[0].body.title, '⏹️ 已中止')
  assert.match(bark.received[0].body.body, /运行已被手动中止/)
})

test('a failed turn is reported once, never also as finished', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  ctx.emit('agent/status', { agent, status: 'running' })
  ctx.emit('agent/error', { agent, turn: 1, step: 2, error: new Error('boom') })
  ctx.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } })
  ctx.emit('agent/status', { agent, status: 'idle' })
  await waitFor(() => bark.received.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(bark.received.length, 1)
  assert.equal(bark.received[0].body.title, '⚠️ 运行出错')
  assert.match(bark.received[0].body.body, /boom/)
})

test('a forked session is notified while a subagent stays silent', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  finishRun(ctx, { id: 'session-fork1234', session: sessionOf({ parentSession: 'session-origin' }) }, { kind: 'completed' })
  await waitFor(() => bark.received.length === 1)

  finishRun(ctx, { id: 'session-child123', session: sessionOf({ origin: 'subagent', parentSession: 'session-origin', delegationDepth: 1 }) }, { kind: 'completed' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(bark.received.length, 1, 'the subagent run is not notified')
})

test('a restarted run cancels the pending finish notification', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 60 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  finishRun(ctx, agent, { kind: 'completed' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  ctx.emit('agent/status', { agent, status: 'running' })
  await new Promise((resolve) => setTimeout(resolve, 150))

  assert.deepEqual(bark.received, [], 'the debounce absorbed the fleeting idle')
})

test('disposing the agent drops its pending notification', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 60 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  finishRun(ctx, agent, { kind: 'completed' })
  ctx.emit('agent/disposed', { agent })
  await new Promise((resolve) => setTimeout(resolve, 150))

  assert.deepEqual(bark.received, [])
})

test('an idle transition without a turn end is not a finish', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  const agent = { id: 'session-abcdef123456', session: sessionOf() }
  finishRun(ctx, agent, undefined)
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.deepEqual(bark.received, [])
})

test('an approval request is observed and delegated untouched', async (t) => {
  const bark = await barkServer()
  t.after(() => bark.close())
  const ctx = fakeContext()
  apply(ctx, { serverUrl: bark.serverUrl, deviceKey: 'k', settleMs: 0 })

  let delegated = 0
  const outcome = ctx.emit(
    'approval/request',
    {
      agent: { id: 'session-abcdef123456', session: sessionOf() },
      toolName: 'bash',
      displayReason: { en: 'write outside the workspace', zh: '在工作区外写入文件' },
    },
    () => {
      delegated += 1
      return Promise.resolve('allowed-once')
    },
  )
  await waitFor(() => bark.received.length === 1)

  assert.equal(delegated, 1, 'the next answerer still owns the decision')
  assert.equal(await outcome, 'allowed-once')
  assert.equal(bark.received[0].body.title, '🔔 需要授权')
  assert.match(bark.received[0].body.body, /工具：bash/)
  assert.match(bark.received[0].body.body, /在工作区外写入文件/)
})

test('an unconfigured deviceKey logs instead of calling the network', async () => {
  const ctx = fakeContext()
  apply(ctx, { settleMs: 0 })
  finishRun(ctx, { id: 'session-abcdef123456', session: sessionOf() }, { kind: 'completed' })

  assert.ok(ctx.logged('deviceKey is not configured'))
})
