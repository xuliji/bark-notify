/**
 * Bark notifications for the DeepSeek Harness.
 *
 * Sends a Bark push to the user's iPhone (mirrored to Apple Watch) when:
 *   - an agent finishes a run (`agent/status` settles to `idle`),
 *   - a tool call needs a human approval decision (`approval/request`),
 *   - a turn or step errored (`agent/error`).
 *
 * A run that the user stopped, that a parent/hook cancelled, or that failed is
 * NOT reported as a finished run. `agent/status` only ever publishes `idle` and
 * `running`, so the plugin reads the committed `turn/end` reason from the
 * `session/event` feed to tell a completed turn from an aborted one.
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
  notifyOnAbort: false,
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
    notifyOnAbort: flag(source.notifyOnAbort, DEFAULT_SETTINGS.notifyOnAbort),
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

/**
 * True when this agent belongs to a delegated child session.
 *
 * `header.origin` is the durable marker every subagent provider writes
 * (`childSessionMeta` in `dsh-subagent`); `delegationDepth` is written next to
 * it. `header.parentSession` on its own is NOT a subagent marker: a
 * user-initiated session fork records it too (`SessionController.fork`), and a
 * forked session is an ordinary session the user expects notifications from.
 * @param agent - the agent to classify.
 * @returns true for delegated child sessions.
 */
export function isSubagent(agent) {
  const header = agent?.session?.header
  if (header === null || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  return header.parentSession !== undefined && header.delegationDepth !== undefined
}

/**
 * Classify the committed `turn/end` reason of the turn that just closed.
 *
 * This mirrors the chat UI, which treats a turn as *stopped* only for
 * `aborted` and as *failed* only for `error`; every other reason is an ordinary
 * settled turn. The remaining members of `TurnEndReasonMap` (`blocked`,
 * `max-tokens`, `interrupted`, `forked`, `legacy`) are pre-step or log-repair
 * artifacts, so they are reported as ordinary finishes. `'none'` means no turn
 * closed during this idle period — a woken driver that found nothing to do.
 * @param reason - the `turn/end` reason, or undefined when none was observed.
 * @returns `'none'`, `'aborted'`, `'error'`, or `'finished'`.
 */
export function turnOutcome(reason) {
  if (reason === null || typeof reason !== 'object') return 'none'
  const kind = reason.kind
  if (kind === 'aborted') return 'aborted'
  if (kind === 'error') return 'error'
  return 'finished'
}

/**
 * Render the human-readable cause of an aborted turn.
 * @param reason - the aborted `turn/end` reason.
 * @returns one short Chinese line describing who cancelled the run.
 */
export function abortCauseText(reason) {
  const cause = reason?.reason
  switch (cause?.kind) {
    case 'user':
      return '运行已被手动中止'
    case 'parent':
      return '运行已被上级 Agent 中止'
    case 'disposed':
      return '会话已关闭，运行被中止'
    case 'hook': {
      const detail = typeof cause.reason === 'string' && cause.reason !== '' ? `：${cause.reason}` : ''
      return `运行被 hook 中止${detail}`
    }
    default:
      return '运行已中止'
  }
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

  /** @type {Map<string, { timer: ReturnType<typeof setTimeout> | undefined }>} */
  const runs = new Map()

  /**
   * Reason of the newest committed `turn/end` per session, consumed by the next
   * `agent/status` idle. Keyed by the live Session so no cleanup is needed.
   * @type {WeakMap<object, object>}
   */
  const turnEnds = new WeakMap()

  const notify = (tag, title, text) => {
    if (settings.deviceKey === '') {
      ctx.logger.info(`bark-notify: ${tag} push skipped because deviceKey is not configured`)
      return
    }
    void sendBark(settings, { title, body: text }, lifetime.signal).then(
      (result) => ctx.logger.debug(`bark-notify: ${tag} push accepted (${result.message})`),
      (error) => {
        if (lifetime.signal.aborted) return
        ctx.logger.warn(`bark-notify: ${tag} push failed: ${messageOf(error)}`)
      },
    )
  }

  const eligible = (agent) => settings.includeSubagents || !isSubagent(agent)

  /** Join the non-empty lines of one notification body. */
  const body = (...lines) => lines.filter((line) => line !== '').join('\n')

  const stateOf = (id) => {
    let state = runs.get(id)
    if (state === undefined) {
      state = { timer: undefined }
      runs.set(id, state)
    }
    return state
  }

  /** Drop the debounce timer a superseded or disposed agent left behind. */
  const disarm = (state) => {
    if (state?.timer === undefined) return
    clearTimeout(state.timer)
    state.timer = undefined
  }

  // `turn/end` is appended to the session log before the loop settles the agent,
  // and this feed is invoked synchronously during that append, so the reason is
  // always in place by the time `agent/status` publishes `idle`.
  ctx.on('session/event', (session, event) => {
    if (session === null || typeof session !== 'object') return
    if (event?.type !== 'turn/end') return
    const reason = event.data?.reason
    if (reason !== null && typeof reason === 'object') turnEnds.set(session, reason)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const id = typeof agent?.id === 'string' ? agent.id : ''
    if (id === '') return
    const state = stateOf(id)
    disarm(state)
    // `agent/status` is published only on a real transition, so `idle` always
    // closes a running phase; the reason of the last turn says how it closed.
    if (status !== 'idle') return

    const session = agent?.session
    const tracked = session !== null && typeof session === 'object'
    const reason = tracked ? turnEnds.get(session) : undefined
    if (tracked) turnEnds.delete(session)

    if (!eligible(agent)) return
    const outcome = turnOutcome(reason)
    if (outcome === 'none') {
      // Nothing closed a turn in this idle period: a woken driver that found no
      // work is not a finished run.
      ctx.logger.debug(`bark-notify: finish push skipped for "${id}" because no turn ended`)
      return
    }
    if (outcome === 'error') {
      // `agent/error` already pushed the failure; a second "finished" push here
      // would report a run that failed as a success.
      ctx.logger.debug(`bark-notify: finish push skipped for "${id}" because its turn errored`)
      return
    }
    if (outcome === 'aborted' && !settings.notifyOnAbort) {
      ctx.logger.debug(`bark-notify: finish push skipped for "${id}" because its turn was ${String(reason?.reason?.kind ?? 'aborted')}-aborted`)
      return
    }
    if (outcome === 'finished' && !settings.notifyOnFinish) return

    const render = outcome === 'aborted'
      ? () => notify('abort', '⏹️ 已中止', body(abortCauseText(reason), describeSession(ctx, agent)))
      : () => notify('finish', '✅ 任务完成', body('Agent 本轮运行已结束', describeSession(ctx, agent)))
    if (settings.settleMs <= 0) {
      render()
      return
    }
    state.timer = setTimeout(() => {
      state.timer = undefined
      render()
    }, settings.settleMs)
  })

  // `prepend: true` is required: the Host registers a terminal answerer at boot
  // that answers without calling next(), so a tail listener never observes a request.
  ctx.on('approval/request', (request, next) => {
    if (settings.notifyOnApproval && eligible(request?.agent)) {
      const tool = typeof request?.toolName === 'string' && request.toolName !== '' ? request.toolName : '未知工具'
      const reason = approvalReason(request)
      notify('approval', '🔔 需要授权', body(`工具：${tool}`, reason === '' ? '' : `原因：${reason}`, describeSession(ctx, request?.agent)))
    }
    return next()
  }, { prepend: true })

  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    if (!settings.notifyOnError || !eligible(agent)) return
    notify('error', '⚠️ 运行出错', body(`第 ${turn} 轮 / 第 ${step} 步出错`, messageOf(error).slice(0, 300), describeSession(ctx, agent)))
  })

  // A disposed agent can never report anything again: release its per-run state
  // and cancel a notification whose session is already gone.
  ctx.on('agent/disposed', ({ agent }) => {
    const id = typeof agent?.id === 'string' ? agent.id : ''
    if (id === '') return
    disarm(runs.get(id))
    runs.delete(id)
  })

  ctx.effect(
    () => () => {
      for (const state of runs.values()) disarm(state)
      runs.clear()
      lifetime.abort(new Error('bark-notify: plugin disposed'))
    },
    'bark-notify.lifecycle()',
  )
}
