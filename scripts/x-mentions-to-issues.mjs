// Prototype loop: X mentions of @omarchy -> one issue each -> optional reply with the link.
// No approval, rate limits, vouch, or duplicate check. Never point TARGET_REPO at omacom/omarchy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fetchMentions, fetchUsers, postReply } from './x.mjs'
import { draftIssue } from './ai.mjs'
import { toIssue, fileIssue, ensureLabels, isReport } from './issue.mjs'

const STATE = new URL('../state/since_id.txt', import.meta.url)
const env = process.env
const repo = env.TARGET_REPO || 'stevederico/omarchy'
const accountId = env.X_ACCOUNT_ID || '2108454467309883392'
const dryRun = String(env.DRY_RUN ?? 'true') !== 'false'
const replyOnX = Boolean(env.X_OMARCHY_USER_TOKEN) // no token, no reply; issues only

if (repo.toLowerCase() === 'omacom/omarchy') {
  console.error('Refusing to file into omacom/omarchy from the prototype. Use a fork.')
  process.exit(1)
}

const sinceId = existsSync(STATE) ? readFileSync(STATE, 'utf8').trim() || undefined : undefined
const res = await fetchMentions({ accountId, sinceId, bearer: env.X_BEARER_TOKEN })
const posts = (res.data ?? []).filter(p => p.author_id !== accountId).reverse() // oldest first
const reports = posts.filter(isReport)
const users = await fetchUsers({ ids: reports.map(p => p.author_id), bearer: env.X_BEARER_TOKEN })
const tweets = Object.fromEntries((res.includes?.tweets ?? []).map(t => [t.id, t]))

console.log(`${posts.length} new mention(s), ${reports.length} look like reports, since ${sinceId ?? 'the start'}; target ${repo}; dry run ${dryRun}; reply on X ${replyOnX}`)
const token = env.GH_TOKEN
if (!dryRun && reports.length) await ensureLabels({ repo, token })

for (const post of reports) {
  const parentId = post.referenced_tweets?.find(r => r.type === 'replied_to')?.id
  const ai = await draftIssue({ text: post.text, parentText: tweets[parentId]?.text, token: env.MODELS_TOKEN, model: env.AI_MODEL || undefined })
  const issue = toIssue(post, { users, tweets, ai })
  if (dryRun) {
    console.log(`would file: ${issue.title}\n  from ${issue.url}\n${issue.body.replace(/^/gm, '  | ')}`)
    continue
  }
  const issueUrl = await fileIssue({ repo, ...issue, token })
  console.log(`filed ${issueUrl} for ${issue.url}`)
  if (replyOnX) await postReply({ text: `Tracked: ${issueUrl}`, inReplyTo: post.id, userToken: env.X_OMARCHY_USER_TOKEN })
}

const newest = res.meta?.newest_id
if (newest) writeFileSync(STATE, `${newest}\n`)
