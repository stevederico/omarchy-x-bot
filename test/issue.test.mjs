import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toIssue, stripMentions, fileIssue, ensureLabels, isReport, parentOf, findCandidates } from '../scripts/issue.mjs'


test('a tagged post without an AI verdict becomes a draft issue, no bug label', () => {
  const issue = toIssue({ id: '99', author_id: '1', text: '@omarchy wifi drops after resume' })
  assert.equal(issue.title, '[X] wifi drops after resume')
  assert.match(issue.body, /Reported on X: https:\/\/x.com\/i\/status\/99/)
  assert.match(issue.body, /> @\u200bomarchy wifi drops after resume/)
  assert.deepEqual(issue.labels, ['from-x', 'needs-triage'])
})

test('a bare tag under a post takes its title from the parent', () => {
  const tweets = { '50': { id: '50', text: 'bar clock is a minute behind after suspend' } }
  const post = { id: '99', author_id: '1', text: '@omarchy', referenced_tweets: [{ type: 'replied_to', id: '50' }] }
  const issue = toIssue(post, { tweets })
  assert.equal(issue.title, '[X] bar clock is a minute behind after suspend')
  assert.match(issue.body, /In reply to:/)
})

test('mentions are stripped from the title only', () => {
  assert.equal(stripMentions('@omarchy  hi @Omarchy there'), 'hi there')
})

test('the issue is POSTed to the target repo with its labels', async () => {
  let call
  const fetchImpl = async (url, init) => { call = { url, init }; return { ok: true, json: async () => ({ html_url: 'https://github.com/me/fork/issues/1' }) } }
  const url = await fileIssue({ repo: 'me/fork', title: 't', body: 'b', labels: ['bug', 'from-x', 'needs-triage'], token: 'x', fetchImpl })
  assert.equal(url, 'https://github.com/me/fork/issues/1')
  assert.equal(call.url, 'https://api.github.com/repos/me/fork/issues')
  assert.deepEqual(JSON.parse(call.init.body), { title: 't', body: 'b', labels: ['bug', 'from-x', 'needs-triage'] })
})

test('an existing label (422) is fine', async () => {
  const fetchImpl = async () => ({ ok: false, status: 422, text: async () => 'exists' })
  await ensureLabels({ repo: 'me/fork', token: 'x', fetchImpl })
})

test('any mention with a keyword counts as a report', () => {
  const reply = { referenced_tweets: [{ type: 'replied_to', id: '1' }] }
  assert.equal(isReport({ ...reply, text: '@omarchy Welcome to X!' }), false)
  assert.equal(isReport({ ...reply, text: '@omarchy please fix polkit, windows are broken' }), true)
  assert.equal(isReport({ text: 'polkit is broken after update @omarchy' }), true)
  assert.equal(isReport({ text: 'love it @omarchy' }), false)
})

test('crash, error, not working, and doesn\'t work count too', () => {
  for (const text of ['waybar crashed on login', 'Errors in the log', 'wifi not working', "audio doesn't work", 'audio doesnt work', 'audio doesn’t work']) {
    assert.equal(isReport({ text }), true, text)
  }
  for (const text of ['working great', 'terror movie night', 'it does work', 'hangover', 'prefix'] ) assert.equal(isReport({ text }), false, text)
})

test('the new words and phrases count, matched as whole words', () => {
  for (const text of ['screen froze, now frozen', 'laptop won’t boot', 'Black screen after login', 'hyprland is laggy', 'stuck on the lock screen']) {
    assert.equal(isReport({ text }), true, text)
  }
})

test('a matched author shows up as name and handle', () => {
  const issue = toIssue({ id: '99', author_id: '1', text: 'bug @omarchy' }, { users: { '1': { name: 'Alice Smith', username: 'alice' } } })
  assert.match(issue.body, /Reported by Alice Smith \(@\u200balice\) on X: https:\/\/x.com\/alice\/status\/99/)
})

test('handles in the body never @mention GitHub users', () => {
  const tweets = { '5': { id: '5', text: 'cc @tcballard' } }
  const post = { id: '9', author_id: '1', text: '@omarchy bug, see @ubermetroid', referenced_tweets: [{ type: 'replied_to', id: '5' }] }
  const issue = toIssue(post, { tweets, users: { '1': { name: '@pinger', username: 'alex' } }, ai: { title: 'T', body: 'ask @someone' } })
  assert.doesNotMatch(issue.body, /@[\w-]/)
  assert.equal(issue.url, 'https://x.com/alex/status/9')
})

test('an AI draft becomes the title and body, marked as a summary, with the X post kept below', () => {
  const issue = toIssue({ id: '7', text: '@omarchy chrome is broken' }, { ai: { title: 'Chrome flickers on 4K', body: "## What's wrong?\nFlicker" } })
  assert.equal(issue.title, 'Chrome flickers on 4K')
  assert.match(issue.body, /^_AI summary of the X post below\. Check it against the post\._\n\n## What's wrong\?/)
  assert.match(issue.body, /> @\u200bomarchy chrome is broken/)
  assert.deepEqual(issue.labels, ['bug', 'from-x', 'needs-triage'])
})

test('a long fallback title is cut at 80 characters without splitting an emoji', () => {
  const issue = toIssue({ id: '1', text: `@omarchy ${'a'.repeat(79)}🐛 broken` })
  assert.equal(issue.title, `[X] ${'a'.repeat(79)}🐛`)
})

test('parentOf finds the replied-to post only', () => {
  const tweets = { '5': { id: '5', text: 'p' }, '6': { id: '6', text: 'q' } }
  assert.equal(parentOf({ referenced_tweets: [{ type: 'quoted', id: '6' }, { type: 'replied_to', id: '5' }] }, tweets).text, 'p')
  assert.equal(parentOf({ referenced_tweets: [{ type: 'quoted', id: '6' }] }, tweets), undefined)
  assert.equal(parentOf({}, tweets), undefined)
})

test('related upstream issues are listed as code, not links, so omacom gets no backlink', () => {
  const related = [{ number: 6475, state: 'open', title: 'D-Bus idle inhibits dropped `x` @dhh' }]
  const issue = toIssue({ id: '1', text: '@omarchy idle is broken' }, { ai: { title: 'T', body: 'B' }, related })
  assert.match(issue.body, /### Possibly related upstream \(AI match, not verified\)\n\n- `omacom\/omarchy#6475` \(open\) D-Bus idle inhibits dropped 'x' @\u200bdhh\n\n---/)
  assert.doesNotMatch(issue.body, /github\.com\/omacom/)
})

test('findCandidates searches upstream broadly on the first two cleaned keywords', async () => {
  const queries = []
  const fetchImpl = async u => {
    const q = new URL(u).searchParams.get('q'); queries.push(q)
    return { ok: true, json: async () => ({ items: q.endsWith(' idle') ? [{ number: 1, title: 't', state: 'open' }] : [] }) }
  }
  assert.deepEqual(await findCandidates({ terms: 'idle repo:evil/x video', token: 't', fetchImpl }), [{ number: 1, title: 't', state: 'open' }])
  assert.deepEqual(queries, ['repo:omacom/omarchy is:issue idle repo', 'repo:omacom/omarchy is:issue idle'])
  assert.deepEqual(await findCandidates({ terms: '', token: 't', fetchImpl: async () => { throw new Error('no call') } }), [])
})
