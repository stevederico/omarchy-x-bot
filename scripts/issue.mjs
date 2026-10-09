// Turn one X mention into a GitHub issue draft, and file it with the GitHub REST API via fetch.
const GH = 'https://api.github.com'

export const LABELS = ['from-x', 'needs-triage']

export const KEYWORDS = ['bug', 'broken', 'fix', 'issue']

// File any mention (typed tag or plain reply to @omarchy) that uses a keyword.
export function isReport(post) {
  return KEYWORDS.some(k => new RegExp(`\\b${k}`, 'i').test(post.text))
}


export function toIssue(post, { users = {}, tweets = {} } = {}) {
  const handle = users[post.author_id]?.username ?? post.author_id
  const url = `https://x.com/${handle}/status/${post.id}`
  const parentRef = post.referenced_tweets?.find(r => r.type === 'replied_to')
  const parent = parentRef && tweets[parentRef.id]
  const text = stripMentions(post.text) || stripMentions(parent?.text ?? '')
  const firstLine = text.split('\n')[0].slice(0, 80) || 'Tagged post'
  const quote = s => s.split('\n').map(l => `> ${l}`).join('\n')

  let body = `Reported by @${handle} on X: ${url}\n\n${quote(post.text)}\n`
  if (parent) body += `\nIn reply to:\n\n${quote(parent.text)}\n`
  body += '\n_Filed automatically from X (prototype)._\n'

  return { title: `[X] ${firstLine}`, body, labels: LABELS, url }
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
  const colors = { 'from-x': '000000', 'needs-triage': 'fbca04' }
  for (const name of LABELS) {
    const res = await fetchImpl(`${GH}/repos/${repo}/labels`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ name, color: colors[name] })
    })
    if (!res.ok && res.status !== 422) throw new Error(`GitHub label ${res.status}: ${await res.text()}`)
  }
}
