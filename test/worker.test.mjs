import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { dispatch } from '../worker/index.js'

const env = { REPO: 'me/bot', WORKFLOW: 'x-mentions.yml', REF: 'main', GITHUB_TOKEN: 'tok' }

test('the cron dispatches the workflow on main with the token', async () => {
  let call
  await dispatch(env, async (url, init) => { call = { url, init }; return { status: 204 } })
  assert.equal(call.url, 'https://api.github.com/repos/me/bot/actions/workflows/x-mentions.yml/dispatches')
  assert.equal(call.init.headers.authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(call.init.body), { ref: 'main', inputs: { mode: 'auto' } })
})

test('a failed dispatch throws so it shows in the Worker logs', async () => {
  await assert.rejects(dispatch(env, async () => ({ status: 403, text: async () => 'no' })), /GitHub dispatch 403: no/)
})

test('the scheduled handler hands the dispatch to waitUntil', async () => {
  const waited = []
  const real = globalThis.fetch
  globalThis.fetch = async () => ({ status: 204 })
  try {
    await worker.scheduled({}, env, { waitUntil: p => waited.push(p) })
    await Promise.all(waited)
    assert.equal(waited.length, 1)
  } finally {
    globalThis.fetch = real
  }
})
