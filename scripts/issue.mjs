// Turn one X mention into a GitHub issue draft, and file it with the GitHub REST API via fetch.
import { clip } from './ai.mjs'

const GH = 'https://api.github.com'

// `bug` only goes on posts the AI called a bug; the rest stay drafts for triage.
export const LABELS = ['bug', 'from-x', 'needs-triage']
export const DRAFT_LABELS = ['from-x', 'needs-triage']

// Regex sources, matched at the start of a word: "fix" also catches fixed, fixes, fixing.
export const KEYWORDS = ['bug', 'broken', 'fix', 'issue', 'crash', 'error', 'not working', "doesn['’]?t work"]

// File any mention (typed tag or plain reply to @omarchy) that uses a keyword.
export function isReport(post) {
  return KEYWORDS.some(k => new RegExp(`\\b${k}`, 'i').test(post.text))
}

// The post this one replies to, when X included it.
export function parentOf(post, tweets = {}) {
  const ref = post.referenced_tweets?.find(r => r.type === 'replied_to')
  return ref && tweets[ref.id]
}

// X handles are GitHub @mentions too (github.com/omarchy is a real user), so break them with a zero-width space.
export function noPing(s) {
  return s.replace(/@(?=[\w-])/g, '@\u200b')
}

export function toIssue(post, { users = {}, tweets = {}, ai = null } = {}) {
  const user = users[post.author_id]
  const handle = user?.username
  const url = handle ? `https://x.com/${handle}/status/${post.id}` : `https://x.com/i/status/${post.id}`
  const by = handle ? `by ${user.name ? `${noPing(user.name)} ` : ''}(${noPing(`@${handle}`)}) ` : ''
  const parent = parentOf(post, tweets)
  const text = stripMentions(post.text) || stripMentions(parent?.text ?? '')
  const firstLine = clip(text.split('\n')[0], 80) || 'Tagged post'
  const quote = s => noPing(s).split('\n').map(l => `> ${l}`).join('\n')

  let body = ai ? `_AI summary of the X post below. Check it against the post._\n\n${noPing(ai.body)}\n\n---\n\n` : ''
  body += `Reported ${by}on X: ${url}\n\n${quote(post.text)}\n`
  if (parent) body += `\nIn reply to:\n\n${quote(parent.text)}\n`
  body += '\n_Filed automatically from X (prototype)._\n'

  return { title: ai?.title || `[X] ${firstLine}`, body, labels: ai ? LABELS : DRAFT_LABELS, url }
}

export function stripMentions(text) {
  return text.replace(/(^|\s)@omarchy\b/gi, ' ').replace(/\s+/g, ' ').trim()
}

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'omarchy-x-bot'
  }
}

export async function fileIssue({ repo, title, body, labels, token, fetchImpl = fetch }) {
  const res = await fetchImpl(`${GH}/repos/${repo}/issues`, {
    method: 'POST', headers: headers(token), body: JSON.stringify({ title, body, labels })
  })
  if (!res.ok) throw new Error(`GitHub issue ${res.status}: ${await res.text()}`)
  return (await res.json()).html_url
}

// Create the labels if missing; 422 means it already exists.
export async function ensureLabels({ repo, token, fetchImpl = fetch }) {
  const colors = { bug: 'd73a4a', 'from-x': '000000', 'needs-triage': 'fbca04' }
  for (const name of LABELS) {
    const res = await fetchImpl(`${GH}/repos/${repo}/labels`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ name, color: colors[name] })
    })
    if (!res.ok && res.status !== 422) throw new Error(`GitHub label ${res.status}: ${await res.text()}`)
  }
}
