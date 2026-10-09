import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { kvState, runOnce, RunLock } from '../worker/index.js'

const kv = (init = {}) => {
  const m = new Map(Object.entries(init)); const puts = []
  return { get: async k => m.get(k) ?? null, put: async (k, v) => { puts.push([k, v]); m.set(k, v) }, puts }
}

test('KV state writes the newest id once, and only when it moved', async () => {
  const store = kv({ since_id: '5' })
  const s = kvState(store)
  assert.equal(await s.read(), '5')
  s.write('6'); s.write('7')
  await s.flush()
  assert.deepEqual(store.puts, [['since_id', '7']])
  const same = kvState(store); await same.read(); await same.flush()
  assert.equal(store.puts.length, 1)
})

test('a run that throws still saves the posts it handled', async () => {
  const store = kv({ since_id: '1' })
  const fetchImpl = async url => {
    if (url.includes('/mentions?')) return { ok: true, json: async () => ({ data: [{ id: '3', text: 'hello', author_id: 'a' }, { id: '2', text: 'hi', author_id: 'a' }], meta: { newest_id: '3' } }) }
    throw new Error(`unexpected ${url}`)
  }
  await runOnce({ STATE: store, MODE: 'test', X_ACCOUNT_ID: '0' }, fetchImpl)
  assert.deepEqual(store.puts, [['since_id', '3']])
  const failing = async url => { if (url.includes('/mentions?')) throw new Error('X down'); throw new Error(url) }
  await assert.rejects(runOnce({ STATE: store, MODE: 'test', X_ACCOUNT_ID: '0' }, failing), /X down/)
  assert.equal(store.puts.length, 1)
})

test('the run endpoint needs RUN_KEY and a POST to /run', async () => {
  const req = (path, init) => new Request(`https://w.dev${path}`, init)
  assert.equal((await worker.fetch(req('/run', { method: 'POST' }), {})).status, 404)
  assert.equal((await worker.fetch(req('/run', { method: 'GET' }), { RUN_KEY: 'k' })).status, 404)
  assert.equal((await worker.fetch(req('/run', { method: 'POST', headers: { authorization: 'Bearer nope' } }), { RUN_KEY: 'k' })).status, 401)
})

// An in-memory stand-in for the Durable Object binding.
function lockBinding() {
  const store = new Map()
  const obj = new RunLock({ storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v) }, delete: async k => { store.delete(k) } } })
  return { idFromName: n => n, get: () => ({ fetch: url => obj.fetch(new Request(url)) }), store }
}

test('the lock lets one run in at a time and frees up after', async () => {
  const LOCK = lockBinding()
  const acquire = async () => (await (await LOCK.get().fetch('https://lock/acquire')).json()).ok
  assert.equal(await acquire(), true)
  assert.equal(await acquire(), false)
  await LOCK.get().fetch('https://lock/release')
  assert.equal(await acquire(), true)
})

test('a run is skipped while another holds the lock, and releases it when done', async () => {
  const LOCK = lockBinding()
  const store = kv({ since_id: '1' })
  const fetchImpl = async url => {
    if (url.includes('/mentions?')) return { ok: true, json: async () => ({ data: [], meta: {} }) }
    throw new Error(url)
  }
  await LOCK.get().fetch('https://lock/acquire')
  assert.deepEqual(await runOnce({ STATE: store, LOCK, MODE: 'test', X_ACCOUNT_ID: '0' }, fetchImpl), { skipped: true })
  await LOCK.get().fetch('https://lock/release')
  assert.deepEqual(await runOnce({ STATE: store, LOCK, MODE: 'test', X_ACCOUNT_ID: '0' }, fetchImpl), { stopped: false })
  assert.equal(LOCK.store.size, 0)
})
