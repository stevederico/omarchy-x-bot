// Prototype loop: X mentions of @omarchy -> one issue each -> optional reply with the link.
// No approval, rate limits, vouch, or duplicate check. Never point TARGET_REPO at omacom/omarchy.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchMentions, fetchUsers, postReply } from './x.mjs'
import { draftIssue, AIUnavailableError } from './ai.mjs'
import { toIssue, fileIssue, ensureLabels, isReport, parentOf } from './issue.mjs'

const SINCE = new URL('../state/since_id.txt', import.meta.url)
const SKIPPED = new URL('../state/skipped.txt', import.meta.url)

// since_id.txt holds the last post handled; skipped.txt lists posts the AI called not a bug, so none are lost.
export const fileState = {
  read: () => existsSync(SINCE) ? readFileSync(SINCE, 'utf8').trim() || undefined : undefined,
  write: id => writeFileSync(SINCE, `${id}\n`),
  skip: line => appendFileSync(SKIPPED, `${line}\n`)
}

// since_id moves forward after each post, so a crash mid-run never files the same post twice.
export async function run({ env = process.env, state = fileState, fetchImpl = fetch } = {}) {
  const repo = env.TARGET_REPO || 'stevederico/omarchy'
  const accountId = env.X_ACCOUNT_ID || '2108454467309883392'
  const dryRun = String(env.DRY_RUN ?? 'true') !== 'false'
  const replyOnX = Boolean(env.X_OMARCHY_USER_TOKEN) // no token, no reply; issues only
  const bearer = env.X_BEARER_TOKEN
  const token = env.GH_TOKEN

  if (repo.toLowerCase() === 'omacom/omarchy') throw new Error('Refusing to file into omacom/omarchy from the prototype. Use a fork.')
  // Without a verdict, every keyword match would be filed, and nearly all of them are chatter.
  if (!dryRun && !env.XAI_API_KEY) throw new Error('XAI_API_KEY is required to go live.')

  const sinceId = state.read()
  const res = await fetchMentions({ accountId, sinceId, bearer, fetchImpl })
  const posts = (res.data ?? []).filter(p => p.author_id !== accountId).reverse() // oldest first
  const tweets = Object.fromEntries((res.includes?.tweets ?? []).map(t => [t.id, t]))
  const users = {}

  console.log(`${posts.length} new mention(s), ${posts.filter(isReport).length} look like reports, since ${sinceId ?? 'the start'}; target ${repo}; dry run ${dryRun}; reply on X ${replyOnX}`)
  if (!dryRun && posts.some(isReport)) await ensureLabels({ repo, token, fetchImpl })

  for (const post of posts) {
    if (isReport(post)) {
      let ai
      try {
        ai = await draftIssue({ text: post.text, parentText: parentOf(post, tweets)?.text, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl })
      } catch (e) {
        if (!(e instanceof AIUnavailableError)) throw e
        console.error(`${e.message}; stopping, will retry from this post next run`)
        return { stopped: true }
      }
      if (ai?.bug === false) {
        console.log(`skip, not a bug: https://x.com/i/status/${post.id}`)
        if (!dryRun) state.skip(`https://x.com/i/status/${post.id}`)
      } else {
        // Look up authors only for posts being filed ($0.01 per user).
        if (!(post.author_id in users)) {
          try {
            Object.assign(users, await fetchUsers({ ids: [post.author_id], bearer, fetchImpl }))
          } catch (e) {
            console.error(`${e.message}; filing without the author's name`)
          }
          users[post.author_id] ??= null
        }
        const issue = toIssue(post, { users, tweets, ai })
        if (dryRun) {
          console.log(`would file: ${issue.title} [${issue.labels.join(', ')}]\n  from ${issue.url}\n${issue.body.replace(/^/gm, '  | ')}`)
        } else {
          const issueUrl = await fileIssue({ repo, ...issue, token, fetchImpl })
          console.log(`filed ${issueUrl} for ${issue.url}`)
          if (replyOnX) {
            try {
              await postReply({ text: `Tracked: ${issueUrl}`, inReplyTo: post.id, userToken: env.X_OMARCHY_USER_TOKEN, fetchImpl })
            } catch (e) {
              console.error(`${e.message}; issue filed, reply skipped`)
            }
          }
        }
      }
    }
    state.write(post.id)
  }

  if (res.meta?.newest_id) state.write(res.meta.newest_id)
  return { stopped: false }
}

// A stopped run fails the job so a dead AI shows up red, after state is saved.
if (process.argv[1] === fileURLToPath(import.meta.url) && (await run()).stopped) process.exitCode = 1
