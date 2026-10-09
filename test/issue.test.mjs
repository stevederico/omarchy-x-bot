import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toIssue, stripMentions, fileIssue } from '../scripts/issue.mjs'

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

test('gh is called with repo, title, body and both labels', () => {
  let args
  const url = fileIssue({ repo: 'me/fork', title: 't', body: 'b', labels: ['from-x', 'needs-triage'] },
    (_cmd, a) => { args = a; return 'https://github.com/me/fork/issues/1\n' })
  assert.equal(url, 'https://github.com/me/fork/issues/1')
  assert.deepEqual(args, ['issue', 'create', '--repo', 'me/fork', '--title', 't', '--body', 'b', '--label', 'from-x', '--label', 'needs-triage'])
})
