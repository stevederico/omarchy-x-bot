// Turn one X mention into a GitHub issue draft, and file it with the GitHub REST API via fetch.
import { clip } from './ai.mjs'

export const GH = 'https://api.github.com'

// `bug` only goes on posts the AI called a bug; the rest stay drafts for triage.
export const LABELS = ['bug', 'from-x', 'needs-triage']
export const DRAFT_LABELS = ['from-x', 'needs-triage']

// Regex sources, matched at the start of a word: "fix" also catches fixed, fixes, fixing.
export const KEYWORDS = ['bug', 'broken', 'fix', 'issue', 'crash', 'error', 'not working', "doesn['’]?t work"]

// The keywords as an X search, so X only returns (and bills) matching posts. Search matches whole words, so word forms are spelled out.
export const SEARCH_TERMS = ['bug', 'bugs', 'buggy', 'broken', 'fix', 'fixed', 'fixes', 'fixing', 'issue', 'issues', 'crash', 'crashes', 'crashed', 'crashing', 'error', 'errors', '"not working"', '"doesn\'t work"', '"doesnt work"']

export function mentionQuery(handle) {
  return `@${handle} (${SEARCH_TERMS.join(' OR ')}) -from:${handle} -is:retweet`
}

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

export const UPSTREAM = 'omacom/omarchy'

// Up to 15 upstream issues worth showing the AI. A broad search on the first two keywords, so the right issue
// is in the list even when the reporter's words differ from the maintainers' ("movie" vs "video").
export async function findCandidates({ terms, token, repo = UPSTREAM, fetchImpl = fetch }) {
  const words = String(terms ?? '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  for (const n of [2, 1]) {
    if (words.length < n) continue
    const q = new URLSearchParams({ q: `repo:${repo} is:issue ${words.slice(0, n).join(' ')}`, per_page: '15' })
    const res = await fetchImpl(`${GH}/search/issues?${q}`, { headers: headers(token) })
    if (!res.ok) throw new Error(`GitHub search ${res.status}: ${await res.text()}`)
    const items = (await res.json()).items ?? []
    if (items.length) return items.map(i => ({ number: i.number, title: i.title, state: i.state }))
  }
  return []
}

export function toIssue(post, { users = {}, tweets = {}, ai = null, related = [] } = {}) {
  const user = users[post.author_id]
  const handle = user?.username
  const url = handle ? `https://x.com/${handle}/status/${post.id}` : `https://x.com/i/status/${post.id}`
  const by = handle ? `by ${user.name ? `${noPing(user.name)} ` : ''}(${noPing(`@${handle}`)}) ` : ''
  const parent = parentOf(post, tweets)
  const text = stripMentions(post.text) || stripMentions(parent?.text ?? '')
  const firstLine = clip(text.split('\n')[0], 80) || 'Tagged post'
  const quote = s => noPing(s).split('\n').map(l => `> ${l}`).join('\n')

  // Code spans, not links: a link would add a "mentioned this" backlink on the upstream issue.
  const relatedList = related.map(r => `- \`${UPSTREAM}#${r.number}\` (${r.state}) ${noPing(r.title.replace(/`/g, "'"))}`).join('\n')
  let body = ai ? `_AI summary of the X post below. Check it against the post._\n\n${noPing(ai.body)}\n\n` : ''
  if (relatedList) body += `### Possibly related upstream (AI match, not verified)\n\n${relatedList}\n\n`
  if (body) body += '---\n\n'
  body += `Reported ${by}on X: ${url}\n\n${quote(post.text)}\n`
  if (parent) body += `\nIn reply to:\n\n${quote(parent.text)}\n`
  body += '\n_Filed automatically from X._\n'

  return { title: ai?.title || `[X] ${firstLine}`, body, labels: ai ? LABELS : DRAFT_LABELS, url }
}

export function stripMentions(text) {
  return text.replace(/(^|\s)@omarchy\b/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function headers(token) {
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

// X post ids that already have an issue in the repo, so a lost since_id never files a post twice.
export async function filedPostIds({ repo, token, fetchImpl = fetch }) {
  const ids = new Set()
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`${GH}/repos/${repo}/issues?labels=from-x&state=all&per_page=100&page=${page}`, { headers: headers(token) })
    if (!res.ok) throw new Error(`GitHub issues ${res.status}: ${await res.text()}`)
    const issues = await res.json()
    for (const i of issues) for (const m of (i.body ?? '').matchAll(/x\.com\/[^/\s]+\/status\/(\d+)/g)) ids.add(m[1])
    if (issues.length < 100) return ids
  }
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
