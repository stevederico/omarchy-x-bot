// Turn one X mention into a GitHub issue draft, and file it with gh.
import { execFileSync } from 'node:child_process'

export const LABELS = ['from-x', 'needs-triage']

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

export function fileIssue({ repo, title, body, labels }, run = execFileSync) {
  const args = ['issue', 'create', '--repo', repo, '--title', title, '--body', body]
  for (const l of labels) args.push('--label', l)
  return run('gh', args, { encoding: 'utf8' }).trim() // gh prints the issue URL
}

export function ensureLabels(repo, run = execFileSync) {
  for (const l of LABELS) {
    try { run('gh', ['label', 'create', l, '--repo', repo, '--force'], { stdio: 'ignore' }) } catch {}
  }
}
