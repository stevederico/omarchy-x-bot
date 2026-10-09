import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../scripts/x-mentions-to-issues.mjs'

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = code => ({ ok: false, status: code, json: async () => ({}), text: async () => 'nope' })
const answer = json => ok({ choices: [{ message: { content: JSON.stringify(json) } }] })

// Fake X, xAI, and GitHub. `ai` maps post text to a model response; `issues` and `replies` record writes.
function world({ posts, ai = {}, users = {}, failIssue = new Set(), failReply = false }) {
  const calls = { issues: [], replies: [], userLookups: [] }
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('/mentions?')) return ok({ data: [...posts].reverse(), meta: { newest_id: posts.at(-1).id } })
    if (url.includes('api.x.com/2/users?')) {
      const ids = new URL(url).searchParams.get('ids').split(',')
      calls.userLookups.push(...ids)
      return ok({ data: ids.filter(id => users[id]).map(id => ({ id, ...users[id] })) })
    }
    if (url.includes('api.x.ai/v1/chat')) {
      const text = JSON.parse(init.body).messages[1].content.match(/<post>\n([\s\S]*?)\n<\/post>/)[1]
      return ai[text] ?? answer({ bug: true, title: `AI: ${text}`, whats_wrong: 'W' })
    }
    if (url.endsWith('/labels')) return fail(422)
    if (url.endsWith('/issues')) {
      const issue = JSON.parse(init.body)
      if (failIssue.has(issue.title)) return fail(502)
      calls.issues.push(issue)
      return ok({ html_url: `https://github.com/me/fork/issues/${calls.issues.length}` })
    }
    if (url.endsWith('/tweets')) {
      if (failReply) return fail(429)
      calls.replies.push(JSON.parse(init.body))
      return ok({})
    }
    throw new Error(`unexpected ${url}`)
  }
  return { calls, fetchImpl }
}

function memoryState(since) {
  const s = { since, skipped: [], read: () => s.since, write: id => { s.since = id }, skip: line => s.skipped.push(line) }
  return s
}

const live = { MODE: 'live', TARGET_REPO: 'me/fork', X_ACCOUNT_ID: '0', XAI_API_KEY: 'k', GH_TOKEN: 'g', X_BEARER_TOKEN: 'x' }
const post = (id, text, author = 'a') => ({ id, text, author_id: author })

test('files bugs, records skipped posts, and moves since_id to the newest post', async () => {
  const { calls, fetchImpl } = world({
    posts: [post('1', 'bar is broken'), post('2', 'fix your website please'), post('3', 'hello')],
    ai: { 'fix your website please': answer({ bug: false }) }
  })
  const state = memoryState()
  await run({ env: live, state, fetchImpl })
  assert.deepEqual(calls.issues.map(i => [i.title, i.labels]), [['AI: bar is broken', ['bug', 'from-x', 'needs-triage']]])
  assert.deepEqual(state.skipped, ['https://x.com/i/status/2'])
  assert.equal(state.since, '3')
})

test('authors are looked up only for posts being filed', async () => {
  const { calls, fetchImpl } = world({
    posts: [post('1', 'not a bug, a question', 'q'), post('2', 'wifi is broken', 'w'), post('3', 'audio broken too', 'w')],
    ai: { 'not a bug, a question': answer({ bug: false }) },
    users: { w: { name: 'W', username: 'w' } }
  })
  await run({ env: live, state: memoryState(), fetchImpl })
  assert.deepEqual(calls.userLookups, ['w'])
  assert.match(calls.issues[0].body, /Reported by W \(@\u200bw\)/)
})

test('a rate-limited AI stops the run before that post, without filing it', async () => {
  const { calls, fetchImpl } = world({
    posts: [post('1', 'one is broken'), post('2', 'two is broken'), post('3', 'three is broken')],
    ai: { 'two is broken': fail(429) }
  })
  const state = memoryState('0')
  assert.deepEqual(await run({ env: live, state, fetchImpl }), { stopped: true })
  assert.deepEqual(calls.issues.map(i => i.title), ['AI: one is broken'])
  assert.equal(state.since, '1')
})

test('only MODE=live files; unset, test, or anything else is test mode', async () => {
  for (const MODE of [undefined, '', 'test', 'TEST', 'false', 'dry']) {
    const { calls, fetchImpl } = world({ posts: [post('1', 'bar is broken')] })
    await run({ env: { ...live, MODE }, state: memoryState(), fetchImpl })
    assert.equal(calls.issues.length, 0, `MODE=${MODE}`)
  }
  const { calls, fetchImpl } = world({ posts: [post('1', 'bar is broken')] })
  await run({ env: { ...live, MODE: 'LIVE' }, state: memoryState(), fetchImpl })
  assert.equal(calls.issues.length, 1)
})

test('going live without an xAI key is refused', async () => {
  await assert.rejects(run({ env: { ...live, XAI_API_KEY: '' }, state: memoryState(), fetchImpl: async () => { throw new Error('no calls') } }), /XAI_API_KEY/)
})

test('unusable AI output files a draft without the bug label', async () => {
  const { calls, fetchImpl } = world({
    posts: [post('1', 'thing is broken')],
    ai: { 'thing is broken': answer({ bug: 'false', title: 'T', whats_wrong: 'W' }) }
  })
  await run({ env: live, state: memoryState(), fetchImpl })
  assert.deepEqual(calls.issues.map(i => [i.title, i.labels]), [['[X] thing is broken', ['from-x', 'needs-triage']]])
})

test('a failed issue keeps since_id at the last filed post, so nothing is filed twice', async () => {
  const { calls, fetchImpl } = world({
    posts: [post('1', 'one is broken'), post('2', 'two is broken'), post('3', 'three is broken')],
    failIssue: new Set(['AI: two is broken'])
  })
  const state = memoryState('0')
  await assert.rejects(run({ env: live, state, fetchImpl }), /GitHub issue 502/)
  assert.equal(calls.issues.length, 1)
  assert.equal(state.since, '1')
})

test('a failed X reply does not stop the run or refile the issue', async () => {
  const { calls, fetchImpl } = world({ posts: [post('1', 'one is broken'), post('2', 'two is broken')], failReply: true })
  const state = memoryState()
  await run({ env: { ...live, X_OMARCHY_USER_TOKEN: 'u' }, state, fetchImpl })
  assert.equal(calls.issues.length, 2)
  assert.equal(state.since, '2')
})

test('test mode writes nothing to GitHub and records no skips', async () => {
  const { calls, fetchImpl } = world({ posts: [post('1', 'bar is broken'), post('2', 'fix the site')], ai: { 'fix the site': answer({ bug: false }) } })
  const state = memoryState()
  await run({ env: { ...live, MODE: 'test' }, state, fetchImpl })
  assert.equal(calls.issues.length, 0)
  assert.deepEqual(state.skipped, [])
  assert.equal(state.since, '2')
})

test('refuses omacom/omarchy', async () => {
  await assert.rejects(run({ env: { ...live, TARGET_REPO: 'Omacom/Omarchy' }, state: memoryState(), fetchImpl: async () => { throw new Error('no calls') } }), /Refusing/)
})
