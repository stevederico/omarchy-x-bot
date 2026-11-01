# omarchy-x-bot v2

v1 (branch `v1`) searches X for `@omarchy` mentions with a bug or feature keyword. It misses reports without a keyword, and a backlog over 100 posts per search skips the oldest ones. v2 fixes both.

## Flow

1. **Read every mention.** One search, `@omarchy -from:omarchy -is:retweet`, no keywords. About 440 mentions a day, about $2.20 a day on X ($0.005 per post).
2. **Read in time windows.** Each run reads from `since_id` forward at most 2 hours (`until_id` = cursor + 2h, or 30 seconds ago). A window holds under 100 posts, so nothing is skipped. If a window is still full, page with `next_token`. An empty window moves the cursor to the window's end.
3. **Triage.** Grok labels each mention bug, feature, or other. Other is skipped (about $0.001 each).
4. **Group duplicates.** A bug or feature that matches an open `from-x` issue gets a comment with the post link and a `+N` count, not a new issue.
5. **File.** New bugs and features become issues on `stevederico/omarchy`. Never `omacom/omarchy`.
6. **Reply by hand.** `npm run queue` opens the reply queue. The bot never posts to X.
7. **Spend cap.** Set in the X and xAI consoles. The bot also stops reading X for the UTC day after `MAX_READS_PER_DAY` posts (default 1,000, $5).
8. **Funnel.** Mentions, bugs and features, issues, replies sent, rebuilt daily as a local page.

## Costs

| What | Cost |
|---|---|
| X reads | about $2.20 a day |
| Grok triage | about $0.50 a day |
| Grok filing | about $0.005 per issue |
| Cloudflare | free plan |

## Order

1. Steps 1 and 2 (read everything, windows)
2. Step 4 (grouping)
3. Steps 7 and 8 (cap, funnel)
