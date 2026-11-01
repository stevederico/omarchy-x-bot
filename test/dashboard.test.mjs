import test from 'node:test'
import assert from 'node:assert/strict'
import { toQueue, toFunnel, dashboardHtml } from '../scripts/dashboard.mjs'

const issue = (n, labels, body, createdAt = '2026-11-01T00:00:00Z') => ({
  number: n, title: `Title <${n}>`, url: `https://github.com/me/omarchy/issues/${n}`, labels: labels.map(name => ({ name })), body, createdAt
})
const body = 'Reported by A (@​ann) on X: https://x.com/ann/status/123\n\n> @​omarchy wifi <broken>\n\n_Filed automatically from X._'

test('builds a reply link with the fixed text for each issue with an X post', () => {
  const [q] = toQueue([issue(1, ['bug', 'from-x'], body), issue(2, ['from-x'], 'no link')])
  assert.equal(q.postId, '123')
  assert.equal(q.handle, 'ann')
  assert.equal(q.kind, 'bug')
  assert.equal(q.quote, '@omarchy wifi <broken>')
  const url = new URL(q.replyUrl)
  assert.equal(url.searchParams.get('in_reply_to'), '123')
  assert.match(url.searchParams.get('text'), /^Tracked: https:\/\/github\.com\/me\/omarchy\/issues\/1\n/)
})

test('features get the feature reply and newest come first', () => {
  const q = toQueue([issue(1, ['bug'], body, '2026-10-01T00:00:00Z'), issue(2, ['enhancement'], body.replace('123', '456'))])
  assert.deepEqual(q.map(x => x.number), [2, 1])
  assert.match(new URL(q[0].replyUrl).searchParams.get('text'), /how you'd use it/)
})

test('escapes post text and titles in the page', () => {
  const html = dashboardHtml({ items: toQueue([issue(1, ['bug'], body)]), funnel: toFunnel({ start: 'a', end: 'b', mentions: 1, keywordMatches: 1 }, []), repo: 'me/omarchy' })
  assert.ok(html.includes('wifi &lt;broken&gt;'))
  assert.ok(html.includes('Title &lt;1&gt;'))
  assert.ok(!html.includes('<broken>'))
})

test('closed issues stay out of the queue', () => {
  assert.equal(toQueue([{ ...issue(1, ['bug'], body), state: 'CLOSED' }]).length, 0)
})

test('funnel counts bugs and features filed inside the window', () => {
  const f = toFunnel({ start: '2026-10-25T00:00:00Z', end: '2026-11-01T00:00:00Z', mentions: 100, keywordMatches: 10 }, [
    issue(1, ['bug'], body, '2026-10-26T00:00:00Z'),
    issue(2, ['enhancement'], body, '2026-10-27T00:00:00Z'),
    issue(3, ['bug'], body, '2026-11-02T00:00:00Z')
  ])
  assert.deepEqual(f.stages.map(s => s.value), [100, 10, 2, 2, null])
  assert.equal(f.stages[2].sub, '1 bugs · 1 features')
})
