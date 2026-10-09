// Cloudflare Worker that runs the bot every 2 minutes. since_id lives in the STATE KV namespace.
import { run } from '../scripts/bot.mjs'

const KEY = 'since_id'

// Reads come from KV; the newest handled post is written back once per run, even if the run fails midway,
// so a crash never files a post twice and the run stays well under KV's free write limit.
export function kvState(kv) {
  let start, latest
  return {
    read: async () => (start = latest = (await kv.get(KEY)) ?? undefined),
    write: id => { latest = id },
    note: line => console.log(line),
    flush: async () => { if (latest && latest !== start) await kv.put(KEY, latest) }
  }
}

export async function runOnce(env, fetchImpl = fetch) {
  const state = kvState(env.STATE)
  try {
    return await run({ env, state, fetchImpl })
  } finally {
    await state.flush()
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
