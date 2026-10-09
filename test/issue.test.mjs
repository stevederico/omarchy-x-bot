import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toIssue, stripMentions, fileIssue, ensureLabels, isReport } from '../scripts/issue.mjs'

const users = { '1': { id: '1', username: 'alice' } }

test('a tagged post becomes an issue with author, link and labels', () => {
  const issue = toIssue({ id: '99', author_id: '1', text: '@omarchy wifi drops after resume' }, { users })
  assert.equal(issue.title, '[X] wifi drops after resume')
  assert.match(issue.body, /Reported by @alice on X: https:\/\/x.com\/alice\/status\/99/)
  assert.match(issue.body, /> @omarchy wifi drops after resume/)
  assert.deepEqual(issue.labels, ['from-x', 'needs-triage'])
})

test('a bare tag under a post takes its title from the parent', () => {
  const tweets = { '50': { id: '50', text: 'bar clock is a minute behind after suspend' } }
  const post = { id: '99', author_id: '1', text: '@omarchy', referenced_tweets: [{ type: 'replied_to', id: '50' }] }
  const issue = toIssue(post, { users, tweets })
  assert.equal(issue.title, '[X] bar clock is a minute behind after suspend')
  assert.match(issue.body, /In reply to:/)
})

test('mentions are stripped from the title only', () => {
  assert.equal(stripMentions('@omarchy  hi @Omarchy there'), 'hi there')
})

test('the issue is POSTed to the target repo with both labels', async () => {
  let call
  const fetchImpl = async (url, init) => { call = { url, init }; return { ok: true, json: async () => ({ html_url: 'https://github.com/me/fork/issues/1' }) } }
  const url = await fileIssue({ repo: 'me/fork', title: 't', body: 'b', labels: ['from-x', 'needs-triage'], token: 'x', fetchImpl })
  assert.equal(url, 'https://github.com/me/fork/issues/1')
  assert.equal(call.url, 'https://api.github.com/repos/me/fork/issues')
  assert.deepEqual(JSON.parse(call.init.body), { title: 't', body: 'b', labels: ['from-x', 'needs-triage'] })
})

test('an existing label (422) is fine', async () => {
  const fetchImpl = async () => ({ ok: false, status: 422, text: async () => 'exists' })
  await ensureLabels({ repo: 'me/fork', token: 'x', fetchImpl })
})

test('only typed @omarchy plus a keyword counts as a report', () => {
  const reply = { referenced_tweets: [{ type: 'replied_to', id: '1' }] }
  assert.equal(isReport({ ...reply, text: '@omarchy Welcome to X!' }), false)
  assert.equal(isReport({ ...reply, text: '@omarchy please fix polkit, windows are broken' }), false)
  assert.equal(isReport({ text: '@omarchy please fix polkit, windows are broken' }), true)
  assert.equal(isReport({ text: 'polkit is broken after update @omarchy' }), true)
  assert.equal(isReport({ text: 'Hey @omarchy found a bug in the bar clock' }), true)
  assert.equal(isReport({ text: 'love it @omarchy' }), false)
  assert.equal(isReport({ text: '@omarchy @dhh this is a real issue, @omarchy fix it' }), true)
})
