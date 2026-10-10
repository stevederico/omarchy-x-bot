// The bot: X mentions of @omarchy -> one issue each -> optional reply with the link from the tagged account.
// Runs anywhere with fetch: the Cloudflare Worker (worker/index.js) or Node (scripts/x-mentions-to-issues.mjs).
// No approval, rate limits, or vouch. Never point TARGET_REPO at omacom/omarchy.
import { searchMentions, fetchUsers, postReply } from './x.mjs'
import { draftIssue, pickRelated, writeIssue, AIUnavailableError } from './ai.mjs'
import { withBodies, repoContext } from './context.mjs'
import { toIssue, fileIssue, ensureLabels, isReport, isStop, parentOf, filedPostIds, noteReply, findCandidates, mentionQueries, STOP_WORDS } from './issue.mjs'

// A fixed reply, never AI text, so a crafted post can't make the bot say anything else.
export function replyText(issueUrl, kind = 'bug') {
  if (kind === 'feature') return `Tracked: ${issueUrl}\n\nTo help, add how you'd use it to the issue.`
  return `Tracked: ${issueUrl}\n\nTo help fix it, add your Omarchy version, the app involved, and the output of omarchy-debug to the issue.`
}

// Worst case of outside calls to handle one report: Grok x3, author, upstream search x2, 3 issue bodies,
// AGENTS.md, tree, manual page, file, reply, reply note. Cloudflare's free plan allows 50 per run.
export const PER_POST = 20

// since_id moves forward after each post, so a crash mid-run never files the same post twice.
export async function run({ env, state, fetchImpl = fetch, maxRequests = Infinity }) {
  const repo = env.TARGET_REPO || 'stevederico/omarchy'
  const accountId = env.X_ACCOUNT_ID || '2108454467309883392'
  const handle = env.X_HANDLE || 'omarchy' // the account people tag; X search needs the handle
  const live = String(env.MODE ?? '').toLowerCase() === 'live' // anything else is test mode
  // OAuth 1.0a keys for the X app and the account that replies. X only takes replies from the account people tagged,
  // so replies stay off unless that account (X_REPLY_USER_ID, saved by npm run connect) is the one being watched.
  const auth = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_REPLY_ACCESS_TOKEN, accessSecret: env.X_REPLY_ACCESS_SECRET }
  const hasReplyKeys = Object.values(auth).every(Boolean)
  const replyOnX = hasReplyKeys && env.X_REPLY_USER_ID === accountId
  if (hasReplyKeys && !replyOnX) console.error(`Reply keys are set, but X_REPLY_USER_ID (${env.X_REPLY_USER_ID}) isn't X_ACCOUNT_ID (${accountId}); replies are off. Run npm run connect as that account.`)
  const bearer = env.X_BEARER_TOKEN
  const token = env.GH_TOKEN || env.GITHUB_TOKEN

  if (repo.toLowerCase() === 'omacom/omarchy') throw new Error('Refusing to file into omacom/omarchy. Use a fork.')
  // Without a verdict, every keyword match would be filed, and nearly all of them are chatter.
  if (live && !env.XAI_API_KEY) throw new Error('XAI_API_KEY is required to go live.')

  // Counts outside calls, so a run stops before a platform cap (Cloudflare's 50 per run) cuts a post off halfway.
  let used = 0
  const f = (...args) => (used++, fetchImpl(...args))

  const sinceId = await state.read()
  const queries = mentionQueries(handle)
  if (replyOnX) queries.push(...mentionQueries(handle, STOP_WORDS)) // opt-outs, needed only while replying
  const res = await searchMentions({ queries, sinceId, bearer, fetchImpl: f })
  const posts = (res.data ?? []).filter(p => p.author_id !== accountId).reverse() // oldest first
  const tweets = Object.fromEntries((res.includes?.tweets ?? []).map(t => [t.id, t]))
  const users = {}
  const stops = new Set(replyOnX ? await state.readStops?.() ?? [] : []) // authors who asked the bot to stop replying
  let filed // { posts, replies }: post ids that already have an issue and the bot's replies, loaded on first need

  console.log(`${posts.length} new matching mention(s), ${posts.filter(isReport).length} look like reports, since ${sinceId ?? 'the last hour'}; target ${repo}; mode ${live ? 'live' : 'test'}; reply on X ${replyOnX}`)
  if (live && posts.some(isReport)) await ensureLabels({ repo, token, fetchImpl: f })

  for (const post of posts) {
    if (live && (isReport(post) || replyOnX)) filed ??= await filedPostIds({ repo, token, fetchImpl: f })
    const answersBot = filed?.replies.has(post.referenced_tweets?.find(r => r.type === 'replied_to')?.id)
    if (replyOnX && isStop(post) && (answersBot || !isReport(post))) {
      stops.add(post.author_id)
      await state.addStop?.(post.author_id)
      console.log(`opted out of replies: https://x.com/i/status/${post.id}`)
    } else if (filed?.posts.has(post.id)) {
      console.log(`already filed: https://x.com/i/status/${post.id}`)
      state.note(`already filed: https://x.com/i/status/${post.id}`)
    } else if (answersBot) {
      // An answer to the bot's "Tracked:" reply (often the details it asked for) belongs on that issue, not a new one.
      console.log(`answer to a bot reply, not filed: https://x.com/i/status/${post.id}`)
      state.note(`answer to a bot reply, not filed: https://x.com/i/status/${post.id}`)
    } else if (isReport(post)) {
      if (used + PER_POST > maxRequests) {
        console.log(`request budget for this run used up; continuing from https://x.com/i/status/${post.id} next run`)
        return { stopped: false }
      }
      let ai
      try {
        ai = await draftIssue({ text: post.text, parentText: parentOf(post, tweets)?.text, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl: f })
      } catch (e) {
        if (!(e instanceof AIUnavailableError)) throw e
        console.error(`${e.message}; stopping, will retry from this post next run`)
        return { stopped: true }
      }
      if (ai?.bug === false) {
        console.log(`skip, not a bug or feature request: https://x.com/i/status/${post.id}`)
        state.note(`skipped, not a bug or feature request: https://x.com/i/status/${post.id}`)
      } else {
        // Look up authors only for posts being filed ($0.01 per user).
        if (!(post.author_id in users)) {
          try {
            Object.assign(users, await fetchUsers({ ids: [post.author_id], bearer, fetchImpl: f }))
          } catch (e) {
            console.error(`${e.message}; filing without the author's name`)
          }
          users[post.author_id] ??= null
        }
        let related = []
        if (ai?.search && token) {
          try {
            const candidates = await findCandidates({ terms: ai.search, token, fetchImpl: f })
            related = await pickRelated({ report: `${ai.title}\n\n${post.text}`, candidates, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl: f })
          } catch (e) {
            console.error(`${e.message}; filing without related issues`)
          }
        }
        // Second pass: rewrite the draft with the related issues' bodies and the Omarchy codebase.
        if (ai) {
          const [relatedFull, context] = token
            ? await Promise.all([withBodies({ related, token, fetchImpl: f }), repoContext({ terms: ai.search, token, fetchImpl: f })])
            : [related, '']
          const better = await writeIssue({ text: post.text, parentText: parentOf(post, tweets)?.text, draft: ai, related: relatedFull, context, token: env.XAI_API_KEY, model: env.AI_MODEL, fetchImpl: f })
          if (better) ai = { ...ai, ...better }
        }
        const issue = toIssue(post, { users, tweets, ai, related, handle })
        if (!live) {
          console.log(`would file: ${issue.title} [${issue.labels.join(', ')}]\n  from ${issue.url}\n${issue.body.replace(/^/gm, '  | ')}`)
          state.note(`would file: ${issue.title} (${issue.url})`)
        } else {
          const issueUrl = await fileIssue({ repo, ...issue, token, fetchImpl: f })
          console.log(`filed ${issueUrl} for ${issue.url}`)
          state.note(`filed: ${issueUrl} (${issue.url})`)
          // No reply for a draft (no AI verdict), or to someone who asked the bot to stop.
          if (replyOnX && ai && !stops.has(post.author_id)) {
            try {
              const reply = await postReply({ text: replyText(issueUrl, ai.kind), inReplyTo: post.id, auth, fetchImpl: f })
              filed?.replies.add(reply.data.id)
              await noteReply({ issueUrl, body: issue.body, replyId: reply.data.id, token, fetchImpl: f })
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
