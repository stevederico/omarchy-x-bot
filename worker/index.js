// Cloudflare Worker that runs the bot every minute. since_id lives in the STATE KV namespace,
// and the RunLock Durable Object makes sure two runs never overlap and file the same post twice.
import { run } from '../scripts/bot.mjs'

// One cursor per watched handle, so switching X_HANDLE never reuses another account's since_id.
// @omarchy keeps the original key.
export const keyFor = (handle = 'omarchy') => handle.toLowerCase() === 'omarchy' ? 'since_id' : `since_id:${handle.toLowerCase()}`

// Reads come from KV; the newest handled post is written back once per run, even if the run fails midway,
// so a crash never files a post twice and the run stays well under KV's free write limit.
// Opt-outs (authors who asked the bot to stop replying) are rare, so each is written right away.
export function kvState(kv, key = keyFor()) {
  let start, latest
  const stopsKey = `opted_out:${key}`
  const readStops = async () => JSON.parse((await kv.get(stopsKey)) ?? '[]')
  return {
    read: async () => (start = latest = (await kv.get(key)) ?? undefined),
    write: id => { latest = id },
    note: line => console.log(line),
    readStops,
    addStop: async id => { const ids = await readStops(); if (!ids.includes(id)) await kv.put(stopsKey, JSON.stringify([...ids, id])) },
    flush: async () => { if (latest && latest !== start) await kv.put(key, latest) }
  }
}

// Cloudflare's free plan allows 50 outside calls per run (1,000 on paid; set MAX_REQUESTS to match).
export const MAX_REQUESTS = 50

// Longer than any run (cron runs stop at 15 minutes), so a crashed run's lock expires on its own.
export const LOCK_MS = 15 * 60_000

// One instance, strongly consistent: acquire either takes the lock or reports it's held.
export class RunLock {
  constructor(ctx) { this.ctx = ctx }
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const now = Date.now()
    if (pathname === '/acquire') {
      if (((await this.ctx.storage.get('until')) ?? 0) > now) return Response.json({ ok: false })
      await this.ctx.storage.put('until', now + LOCK_MS)
      return Response.json({ ok: true })
    }
    if (pathname === '/release') {
      await this.ctx.storage.delete('until')
      return Response.json({ ok: true })
    }
    return new Response('Not found', { status: 404 })
  }
}

const lock = (env, action) => env.LOCK.get(env.LOCK.idFromName('run')).fetch(`https://lock/${action}`)

export async function runOnce(env, fetchImpl = fetch) {
  if (env.LOCK && !(await (await lock(env, 'acquire')).json()).ok) {
    console.log('Previous run still going, skipping this one')
    return { skipped: true }
  }
  const state = kvState(env.STATE, keyFor(env.X_HANDLE))
  try {
    return await run({ env, state, fetchImpl, maxRequests: Number(env.MAX_REQUESTS) || MAX_REQUESTS })
  } finally {
    // Release even if saving fails, so a KV error never holds the lock for 15 minutes.
    try {
      await state.flush()
    } finally {
      if (env.LOCK) await lock(env, 'release')
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOnce(env))
  },

  // POST /run with the RUN_KEY secret runs the bot now, for demos. Without RUN_KEY set, there's no endpoint.
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.RUN_KEY || request.method !== 'POST' || url.pathname !== '/run') return new Response('Not found', { status: 404 })
    if (request.headers.get('authorization') !== `Bearer ${env.RUN_KEY}`) return new Response('Unauthorized', { status: 401 })
    const result = await runOnce(env)
    return Response.json(result)
  }
}
