// The bot: X mentions of @omarchy -> one issue each -> optional reply with the link from the bot's own account.
// Runs anywhere with fetch: the Cloudflare Worker (worker/index.js) or Node (scripts/x-mentions-to-issues.mjs).
// No approval, rate limits, or vouch. Never point TARGET_REPO at omacom/omarchy.
import { fetchMentions, fetchUsers, postReply } from './x.mjs'
import { draftIssue, pickRelated, writeIssue, AIUnavailableError } from './ai.mjs'
import { withBodies, repoContext } from './context.mjs'
import { toIssue, fileIssue, ensureLabels, isReport, parentOf, filedPostIds, findCandidates } from './issue.mjs'

// A fixed reply, never AI text, so a crafted post can't make the bot say anything else.
export function replyText(issueUrl) {
  return `Tracked: ${issueUrl}\n\nTo help fix it, add your Omarchy version, the app involved, and the output of omarchy-debug to the issue.`
}

// since_id moves forward after each post, so a crash mid-run never files the same post twice.
export async function run({ env, state, fetchImpl = fetch }) {
  const repo = env.TARGET_REPO || 'stevederico/omarchy'
  const accountId = env.X_ACCOUNT_ID || '2108454467309883392'
  const live = String(env.MODE ?? '').toLowerCase() === 'live' // anything else is test mode
  // OAuth 1.0a keys for the X app and the account that replies (one you control, not @omarchy); without all four, issues only.
  const auth = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_REPLY_ACCESS_TOKEN, accessSecret: env.X_REPLY_ACCESS_SECRET }
  const replyOnX = Object.values(auth).every(Boolean)
  const bearer = env.X_BEARER_TOKEN
  const token = env.GH_TOKEN || env.GITHUB_TOKEN

  if (repo.toLowerCase() === 'omacom/omarchy') throw new Error('Refusing to file into omacom/omarchy. Use a fork.')
  // Without a verdict, every keyword match would be filed, and nearly all of them are chatter.
  if (live && !env.XAI_API_KEY) throw new Error('XAI_API_KEY is required to go live.')

  const sinceId = await state.read()
  const res = await fetchMentions({ accountId, sinceId, bearer, fetchImpl })
  const posts = (res.data ?? []).filter(p => p.author_id !== accountId).reverse() // oldest first
  const tweets = Object.fromEntries((res.includes?.tweets ?? []).map(t => [t.id, t]))
  const users = {}
  let filed // post ids that already have an issue, loaded on first need

  console.log(`${posts.length} new mention(s), ${posts.filter(isReport).length} look like reports, since ${sinceId ?? 'the start'}; target ${repo}; mode ${live ? 'live' : 'test'}; reply on X ${replyOnX}`)
  if (live && posts.some(isReport)) await ensureLabels({ repo, token, fetchImpl })

  for (const post of posts) {
    if (live && isReport(post)) filed ??= await filedPostIds({ repo, token, fetchImpl })
    if (filed?.has(post.id)) {
      console.log(`already filed: https://x.com/i/status/${post.id}`)
      state.note(`already filed: https://x.com/i/status/${post.id}`)
    } else if (isReport(post)) {
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
        state.note(`skipped, not a bug: https://x.com/i/status/${post.id}`)
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
        let related = []
        if (ai?.search && token) {
          try {
            const candidates = await findCandidates({ terms: ai.search, token, fetchImpl })
            related = await pickRelated({ report: `${ai.title}\n\n${post.text}`, candidates, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl })
          } catch (e) {
            console.error(`${e.message}; filing without related issues`)
          }
        }
        // Second pass: rewrite the draft with the related issues' bodies and the Omarchy codebase.
        if (ai) {
          const [relatedFull, context] = token
            ? await Promise.all([withBodies({ related, token, fetchImpl }), repoContext({ terms: ai.search, token, fetchImpl })])
            : [related, '']
          const better = await writeIssue({ text: post.text, parentText: parentOf(post, tweets)?.text, draft: ai, related: relatedFull, context, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl })
          if (better) ai = { ...ai, ...better }
        }
        const issue = toIssue(post, { users, tweets, ai, related })
        if (!live) {
          console.log(`would file: ${issue.title} [${issue.labels.join(', ')}]\n  from ${issue.url}\n${issue.body.replace(/^/gm, '  | ')}`)
          state.note(`would file: ${issue.title} (${issue.url})`)
        } else {
          const issueUrl = await fileIssue({ repo, ...issue, token, fetchImpl })
          console.log(`filed ${issueUrl} for ${issue.url}`)
          state.note(`filed: ${issueUrl} (${issue.url})`)
          if (replyOnX) {
            try {
              await postReply({ text: replyText(issueUrl), inReplyTo: post.id, auth, fetchImpl })
            } catch (e) {
              console.error(`${e.message}; issue filed, reply skipped`)
            }
          }
        }
      }
    }
    await state.write(post.id)
  }

  if (res.meta?.newest_id) await state.write(res.meta.newest_id)
  return { stopped: false }
}
