/**
 * Bark notifications for the DeepSeek Harness.
 *
 * Sends a Bark push to the user's iPhone (mirrored to Apple Watch) when:
 *   - an agent finishes a run (`agent/status` settles to `idle`),
 *   - a tool call needs a human approval decision (`approval/request`),
 *   - a turn or step errored (`agent/error`).
 *
 * This plugin is a passive observer: it never claims an approval request, it
 * always delegates to the next answerer, so the normal permission UI keeps
 * working exactly as before.
 *
 * Two Harness details shape this implementation:
 *
 * 1. `approval/request` is a waterfall whose FIRST listener is a terminal
 *    answerer (the Host's client bridge) that returns the human's decision
 *    without calling `next()`. A listener registered at the end of the chain
 *    therefore never runs, so the approval listener MUST register with
 *    `{ prepend: true }` to observe the request before that answerer claims it.
 * 2. A bundle installed into a profile is imported from its own directory, so
 *    it must not import packages that only exist inside the dsh installation
 *    (they do not resolve for a profile-linked bundle). This module therefore
 *    has zero imports and validates its own configuration.
 *
 * @module @local/bark-notify
 */

/** Cordis plugin name used in diagnostics. */
export const name = 'bark-notify'

/** Levels accepted by the Bark push API, keyed by their case-insensitive spelling. */
const BARK_LEVELS = new Map([
  ['active', 'active'],
  ['timesensitive', 'timeSensitive'],
  ['passive', 'passive'],
  ['critical', 'critical'],
])

/** Default configuration; every field is overridable from the profile patch layer. */
export const DEFAULT_SETTINGS = {
  serverUrl: 'https://api.day.app',
  deviceKey: '',
  notifyOnFinish: true,
  notifyOnApproval: true,
  notifyOnError: true,
  includeSubagents: false,
  settleMs: 1500,
  timeoutMs: 10000,
  group: 'DeepSeek Harness',
  sound: '',
  level: 'active',
  icon: '',
  url: '',
}

/**
 * Normalize user configuration into the shape the sender consumes.
 * Unknown keys are ignored and every missing or malformed field falls back to
 * {@link DEFAULT_SETTINGS}, so a hand-edited patch cannot break the plugin.
 * @param {Record<string, unknown>} [config] - raw plugin configuration.
 * @returns {typeof DEFAULT_SETTINGS} settings with defaults applied and strings trimmed.
 */
export function resolveSettings(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const text = (value, fallback) => (typeof value === 'string' ? value.trim() : fallback)
  const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const time = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)
  return {
    serverUrl: text(source.serverUrl, DEFAULT_SETTINGS.serverUrl).replace(/\/+$/, '') || DEFAULT_SETTINGS.serverUrl,
    deviceKey: text(source.deviceKey, DEFAULT_SETTINGS.deviceKey),
    notifyOnFinish: flag(source.notifyOnFinish, DEFAULT_SETTINGS.notifyOnFinish),
    notifyOnApproval: flag(source.notifyOnApproval, DEFAULT_SETTINGS.notifyOnApproval),
    notifyOnError: flag(source.notifyOnError, DEFAULT_SETTINGS.notifyOnError),
    includeSubagents: flag(source.includeSubagents, DEFAULT_SETTINGS.includeSubagents),
    settleMs: time(source.settleMs, DEFAULT_SETTINGS.settleMs),
    timeoutMs: time(source.timeoutMs, DEFAULT_SETTINGS.timeoutMs) || DEFAULT_SETTINGS.timeoutMs,
    group: text(source.group, DEFAULT_SETTINGS.group),
    sound: text(source.sound, DEFAULT_SETTINGS.sound),
    level: BARK_LEVELS.get(text(source.level, DEFAULT_SETTINGS.level).toLowerCase()) ?? '',
    icon: text(source.icon, DEFAULT_SETTINGS.icon),
    url: text(source.url, DEFAULT_SETTINGS.url),
  }
}

/** Render one error as a short single-line message. */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * POST one notification to the Bark server.
 * @param {ReturnType<typeof resolveSettings>} settings - resolved settings.
 * @param {{ title: string, body: string }} notification - rendered content.
 * @param {AbortSignal} [signal] - cancellation owned by the plugin's lifetime.
 * @returns {Promise<{ code: number, message: string }>} the parsed Bark response.
 * @throws {Error} when the device key is missing, the request fails, or Bark rejects it.
 */
export async function sendBark(settings, notification, signal) {
  if (settings.deviceKey === '') throw new Error('deviceKey is not configured')
  const payload = {
    device_key: settings.deviceKey,
    title: notification.title,
    body: notification.body,
  }
  if (settings.group !== '') payload.group = settings.group
  if (settings.sound !== '') payload.sound = settings.sound
  if (settings.level !== '') payload.level = settings.level
  if (settings.icon !== '') payload.icon = settings.icon
  if (settings.url !== '') payload.url = settings.url

  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason ?? new Error('aborted'))
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${settings.timeoutMs}ms`)), settings.timeoutMs)
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetch(`${settings.serverUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = (await response.text()).trim()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Bark returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`)
    }
    const code = Number(parsed?.code)
    if (!response.ok || code !== 200) {
      throw new Error(`Bark rejected the push (HTTP ${response.status}, code ${String(parsed?.code)}): ${String(parsed?.message ?? text).slice(0, 200)}`)
    }
    return { code, message: String(parsed?.message ?? 'success') }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Pick the best human-readable reason for an approval request. */
function approvalReason(request) {
  const display = request?.displayReason
  if (display !== null && typeof display === 'object') {
    const preferred = display.zh ?? display.en
    if (typeof preferred === 'string' && preferred !== '') return preferred
  }
  return typeof request?.reason === 'string' && request.reason !== '' ? request.reason : ''
}

/** True when this agent is a delegated child session. */
export function isSubagent(agent) {
  const header = agent?.session?.header
  if (header === null || typeof header !== 'object') return false
  return header.origin === 'subagent' || header.parentSession !== undefined
}

/**
 * Describe the owning session for a notification body.
 * @param {object} ctx - plugin context, used for the optional title service.
 * @param {object} agent - the agent that produced the event.
 * @returns {string} session title and short id, or an empty string.
 */
export function describeSession(ctx, agent) {
  const session = agent?.session
  const id = typeof agent?.id === 'string' ? agent.id : ''
  if (id === '' && (session === undefined || session === null)) return ''
  const short = id.replace(/^session-/, '').slice(0, 8)
  let title = ''
  try {
    const titles = typeof ctx?.get === 'function' ? ctx.get('sessionTitle') : undefined
    const snapshot = titles !== undefined && session !== undefined ? titles.get(session) : undefined
    if (typeof snapshot?.title === 'string') title = snapshot.title
  } catch {
    // A missing or disposed title service never blocks a notification.
  }
  if (title !== '' && short !== '') return `${title}（${short}）`
  return title !== '' ? title : short !== '' ? `会话 ${short}` : ''
}

/**
 * Register the Bark notification listeners.
 * @param {object} ctx - plugin context.
 * @param {Record<string, unknown>} [config] - raw plugin configuration from the profile patch.
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config)
  const lifetime = new AbortController()

  /** @type {Map<string, { started: boolean, timer: ReturnType<typeof setTimeout> | undefined }>} */
  const runs = new Map()

  const notify = (tag, title, body) => {
    if (settings.deviceKey === '') {
      ctx.logger.info(`bark-notify: ${tag} push skipped because deviceKey is not configured`)
      return
    }
    void sendBark(settings, { title, body }, lifetime.signal).then(
      (result) => ctx.logger.debug(`bark-notify: ${tag} push accepted (${result.message})`),
      (error) => {
        if (lifetime.signal.aborted) return
        ctx.logger.warn(`bark-notify: ${tag} push failed: ${messageOf(error)}`)
      },
    )
  }

  const eligible = (agent) => settings.includeSubagents || !isSubagent(agent)

  const stateOf = (id) => {
    let state = runs.get(id)
    if (state === undefined) {
      state = { started: false, timer: undefined }
      runs.set(id, state)
    }
    return state
  }

  ctx.on('agent/status', ({ agent, status }) => {
    const id = typeof agent?.id === 'string' ? agent.id : ''
    if (id === '') return
    const state = stateOf(id)
    if (status === 'running') {
      state.started = true
      if (state.timer !== undefined) {
        clearTimeout(state.timer)
        state.timer = undefined
      }
      return
    }
    if (status !== 'idle' || !state.started) return
    state.started = false
    if (!settings.notifyOnFinish || !eligible(agent)) return
    const fire = () => {
      const session = describeSession(ctx, agent)
      notify('finish', '✅ 任务完成', session === '' ? 'Agent 本轮运行已结束' : `Agent 本轮运行已结束\n${session}`)
    }
    if (settings.settleMs <= 0) {
      fire()
      return
    }
    state.timer = setTimeout(() => {
      state.timer = undefined
      fire()
    }, settings.settleMs)
  })

  // `prepend: true` is required: the Host registers a terminal answerer at boot
  // that answers without calling next(), so a tail listener never observes a request.
  ctx.on('approval/request', (request, next) => {
    if (settings.notifyOnApproval && eligible(request?.agent)) {
      const tool = typeof request?.toolName === 'string' && request.toolName !== '' ? request.toolName : '未知工具'
      const reason = approvalReason(request)
      const session = describeSession(ctx, request?.agent)
      const lines = [`工具：${tool}`]
      if (reason !== '') lines.push(`原因：${reason}`)
      if (session !== '') lines.push(session)
      notify('approval', '🔔 需要授权', lines.join('\n'))
    }
    return next()
  }, { prepend: true })

  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    if (!settings.notifyOnError || !eligible(agent)) return
    const session = describeSession(ctx, agent)
    const lines = [`第 ${turn} 轮 / 第 ${step} 步出错`, messageOf(error).slice(0, 300)]
    if (session !== '') lines.push(session)
    notify('error', '⚠️ 运行出错', lines.join('\n'))
  })

  ctx.effect(
    () => () => {
      for (const state of runs.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer)
      }
      runs.clear()
      lifetime.abort(new Error('bark-notify: plugin disposed'))
    },
    'bark-notify.lifecycle()',
  )
}
