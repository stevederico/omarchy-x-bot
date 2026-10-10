// Turn one X mention into a GitHub issue draft, and file it with the GitHub REST API via fetch.
import { clip } from './ai.mjs'

export const GH = 'https://api.github.com'

// `bug` only goes on posts the AI called a bug; the rest stay drafts for triage.
export const LABELS = ['bug', 'from-x', 'needs-triage']
export const DRAFT_LABELS = ['from-x', 'needs-triage']

// One keyword list for both gates: the X search (so X only returns, and bills, matching posts) and isReport.
// Search matches whole words, so word forms are spelled out. mentionQueries adds curly-apostrophe forms (phones type them)
// and splits the list under X's 512-character cap.
export const KEYWORDS = ['bug', 'bugs', 'buggy', 'bugged', 'broken', 'fix', 'fixed', 'fixes', 'fixing', 'issue', 'issues', 'problem', 'problems',
  'crash', 'crashes', 'crashed', 'crashing', 'error', 'errors', 'errored', 'fail', 'fails', 'failed', 'failing', 'glitch', 'glitchy', 'borked', 'busted', 'wrong',
  'freeze', 'freezes', 'frozen', 'hang', 'hangs', 'stuck', 'lag', 'laggy', 'flicker', 'flickers', 'flickering', 'drops', 'dropping',
  'not working', "isn't working", 'isnt working', "doesn't work", 'doesnt work', 'stopped working',
  "won't start", "won't boot", "won't open", "won't load", "won't work", "can't boot", "can't connect", 'not loading', 'not responding',
  'black screen', 'no sound']

export const QUERY_MAX = 512

// One or more X searches that together cover every keyword, each within X's query length cap.
export function mentionQueries(handle, words = KEYWORDS) {
  const wrap = terms => `@${handle} (${terms.join(' OR ')}) -from:${handle} -is:retweet`
  const queries = [[]]
  for (const term of words.flatMap(k => k.includes("'") ? [k, k.replace("'", '’')] : [k]).map(k => k.includes(' ') ? `"${k}"` : k)) {
    if (queries.at(-1).length && wrap([...queries.at(-1), term]).length > QUERY_MAX) queries.push([])
    queries.at(-1).push(term)
  }
  return queries.map(wrap)
}

// Asking the bot to stop replying, per X's automation rules. Searched only while replies are on.
export const STOP_WORDS = ['stop', 'unsubscribe', 'opt out']
export const isStop = post => new RegExp(`(?<![\\p{L}\\p{N}'])(${STOP_WORDS.join('|')})(?![\\p{L}\\p{N}'])`, 'iu').test(post.text)

// The same whole-word match locally, any case, with curly apostrophes read as straight ones.
const straight = s => s.toLowerCase().replaceAll('’', "'")
const KEYWORD_RE = new RegExp(`(?<![\\p{L}\\p{N}'])(${[...new Set(KEYWORDS.map(straight))].join('|')})(?![\\p{L}\\p{N}'])`, 'u')

// File any mention (typed tag or plain reply to @omarchy) that uses a keyword.
export function isReport(post) {
  return KEYWORD_RE.test(straight(post.text))
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

export function toIssue(post, { users = {}, tweets = {}, ai = null, related = [], handle: tagged = 'omarchy' } = {}) {
  const user = users[post.author_id]
  const handle = user?.username
  const url = handle ? `https://x.com/${handle}/status/${post.id}` : `https://x.com/i/status/${post.id}`
  const by = handle ? `by ${user.name ? `${noPing(user.name)} ` : ''}(${noPing(`@${handle}`)}) ` : ''
  const parent = parentOf(post, tweets)
  const text = stripMentions(post.text, tagged) || stripMentions(parent?.text ?? '', tagged)
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

export function stripMentions(text, handle = 'omarchy') {
  return text.replace(new RegExp(`(^|\\s)@${handle}(?![\\w])`, 'gi'), ' ').replace(/\s+/g, ' ').trim()
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

// X post ids that already have an issue in the repo, so a lost since_id never files a post twice,
// and the bot's own X replies (from "Replied on X:" lines), so an answer to a reply isn't filed as a new report.
export async function filedPostIds({ repo, token, fetchImpl = fetch }) {
  const posts = new Set(), replies = new Set()
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`${GH}/repos/${repo}/issues?labels=from-x&state=all&per_page=100&page=${page}`, { headers: headers(token) })
    if (!res.ok) throw new Error(`GitHub issues ${res.status}: ${await res.text()}`)
    const issues = await res.json()
    for (const i of issues) {
      const body = i.body ?? ''
      for (const m of body.matchAll(/Replied on X: https:\/\/x\.com\/[^/\s]+\/status\/(\d+)/g)) replies.add(m[1])
      for (const m of body.matchAll(/x\.com\/[^/\s]+\/status\/(\d+)/g)) if (!replies.has(m[1])) posts.add(m[1])
    }
    if (issues.length < 100) return { posts, replies }
  }
}

// Note the bot's X reply on the issue, for maintainers and for filedPostIds.
export async function noteReply({ issueUrl, body, replyId, token, fetchImpl = fetch }) {
  const [, repo, number] = issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/)
  const res = await fetchImpl(`${GH}/repos/${repo}/issues/${number}`, {
    method: 'PATCH', headers: headers(token), body: JSON.stringify({ body: `${body}\nReplied on X: https://x.com/i/status/${replyId}\n` })
  })
  if (!res.ok) throw new Error(`GitHub issue update ${res.status}: ${await res.text()}`)
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
