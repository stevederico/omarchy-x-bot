# @omarchy X → GitHub Issue Bot

**Goal:** prove the loop works once, end to end, with the least code.
Tag `@omarchy` on X with a bug or feature request → one issue appears in `omacom/omarchy` → optionally, the tagged account replies with the issue link.

## Scope
In: tag detection, one issue per tagged post, one reply.
In: AI drafting in Omarchy's bug template, feature requests labeled `enhancement`, and skipping posts the AI says are neither.
Out: approval queue, rate limits, vouch, close-the-loop replies.

## Flow
1. Search X for new mentions of `@omarchy` with a keyword (`GET /2/tweets/search/recent?query=@omarchy (bug OR fix OR …) -from:omarchy -is:retweet&since_id=…&end_time=<30s ago>`). X bills each returned post, so filtering in the query means non-matching mentions cost nothing. One keyword list (`KEYWORDS` in `scripts/issue.mjs`) feeds both the search and the local filter, split into as many queries as X's 512-character cap needs, and the results are merged. `end_time` 30 seconds back means a post indexed late is read next run, never passed over. Search reaches back 7 days, so a `since_id` older than 6 days becomes `start_time` 6 days back; with no `since_id` at all, it starts an hour back.
2. For each match (skip @omarchy's own posts), oldest first, Grok (xAI API) reads the post as untrusted text and decides (the post it replies to isn't fetched, since X bills it as a second read):
   - **Bug:** title (under 80 chars) and body in the bug template, marked as an AI summary, with links not in the posts removed. Labels: `bug`, `from-x`, `needs-triage`.
   - **Feature request:** title and body with What's requested?, Likely area, Possible today, and use-case questions. Labels: `enhancement`, `from-x`, `needs-triage`.
   - **Neither:** no issue. The post URL is listed in the Worker logs so it can be reviewed or replayed.
   - **No verdict** (unusable answer, or no key in test mode): a draft issue titled `[X] ` + first 80 chars of the post. Labels: `from-x`, `needs-triage`. No `bug` label, since nothing checked it.
   - **AI API fails** (rate limit, outage, timeout, bad key, retired model, non-JSON reply): stop the run and fail the job. The next run retries from this post. A live run refuses to start without `XAI_API_KEY`.
   - Every issue body keeps the author handle, post URL, quoted post text, and the footer "Filed automatically from X."
3. Look up the author only for posts being filed, and create the issue with the GitHub REST API.
4. Optionally reply from the watched account (only when `X_REPLY_USER_ID` equals `X_ACCOUNT_ID`, since X rejects replies from any other account): "Tracked: <issue url>" plus a fixed ask for the Omarchy version, the app, and `omarchy-debug` output. Never AI text. Signed with OAuth 1.0a, whose tokens don't expire. A failed reply is logged and doesn't stop the run. The reply id goes on the issue as `Replied on X: <url>`, so answers to it are not filed again. No reply for drafts, or to anyone who said `stop`, `unsubscribe`, or `opt out` (kept in KV).
5. Save `since_id` after each post, so a crash midway never files a post twice. The Worker writes it to KV once per run, even when the run fails.
6. Before judging a post in live mode, skip it if an issue labeled `from-x` already links to it, so a lost cache never files duplicates.
7. Count outside calls, and stop before the next report when fewer than 20 of the run's budget (`MAX_REQUESTS`, 50 on Cloudflare's free plan) are left. `since_id` stays at the last handled post, so the next run picks up the rest.

## Runtime
- A Cloudflare Worker (`worker/index.js`) runs the bot (`scripts/bot.mjs`) on a cron every minute, with a Durable Object lock so runs never overlap. GitHub's own schedule was best-effort and never fired, so the GitHub Actions version lives on the `github-actions` branch.
- `since_id` stored in Workers KV, one key per watched handle, written once per run. The KV write and the lock release are separate, so a failed write never holds the lock.
- Worker secrets: `X_BEARER_TOKEN` (read mentions), `GITHUB_TOKEN` (Issues: read and write on the target repo), `XAI_API_KEY` (Grok), optional `RUN_KEY` (POST /run), and optional `X_API_KEY`, `X_API_SECRET`, `X_REPLY_ACCESS_TOKEN`, `X_REPLY_ACCESS_SECRET`, `X_REPLY_USER_ID` (OAuth 1.0a for the watched account, saved in one step by `npm run connect`). GitHub Models was retired on 2026-07-30, so the AI is xAI's API.

## Proving it works
- Tag @omarchy from a test account → within an hour an issue exists with the post link and @omarchy replied with the issue URL.
- Run it on a fork first (`stevederico/omarchy`) so no real issues are filed until the maintainers say yes.

## Context
- Org bots already run this way: plugin marketplace issue automation is GitHub Actions + Node 24 `.mjs` + `gh`/`jq`.
- omarchybot (semi-official reviewer, a regular bot account, not a GitHub App) is the natural owner of the token.
- Design doc lands as a PR to `omacom/omarchy` under `plans/x-issues.md`.

## Later: tag @omarchy to change your own machine
Idea: a user tags @omarchy on X ("@omarchy switch me to the tokyo-night theme", "@omarchy install obsidian") and the request is routed to *their own* Omarchy machine, which runs it locally.

How it could work:
1. **Opt-in pairing.** The user runs something like `omarchy-x link` on their machine, which proves they own the X handle (OAuth or a one-time code posted from that account). This links handle to device. Unlinked handles are ignored.
2. **Local agent pulls, never listens.** A small user service on the machine polls a relay (for example, a Cloudflare Worker, like other omacom Workers) for requests addressed to that device. No open inbound ports.
3. **Intent, not shell.** Post text is never executed. It's mapped to a fixed allowlist of Omarchy actions that already exist as `omarchy-*` commands (theme, font, install or remove a package, toggle a setting, update). Anything else is refused.
4. **Confirm on device.** Each request pops a local notification with the exact command, and nothing runs until the user approves it on the machine. Optionally trust low-risk actions like the theme.
5. **Signed and short-lived.** Requests are signed by the relay, expire in minutes, and are single-use, so they can't be replayed.
6. **Reply on X.** The bot replies "Done" or "Declined" without echoing anything private about the machine.

Risks to solve first:
- X posts are public and spoofable by look-alike handles. Pairing plus on-device confirmation is the main defense.
- Prompt injection through quoted or replied-to posts. Only the tagging author's own text counts.
- Abuse from a compromised X account. Keep confirm-on-device as the default, and add a kill switch (`omarchy-x unlink`).
- Privacy. Commands are public posts, so keep the action set non-sensitive.

Relationship to the plan: this builds on `plans/remote.md` and reuses the same mention-polling loop. Phase: after the issue bot is proven (Phase 3+).

## Later: turn a tag into a pull request

When a filed bug is small and clear, the bot also opens a draft PR with a proposed fix.

1. **Trigger:** a maintainer adds a label (e.g. `x-try-fix`) to the issue. Nothing opens on its own.
2. **Agent:** a coding agent reads the issue, the repo's `AGENTS.md`, and `agents/skills/`, then writes the fix on a branch in a fork.
3. **PR:** a draft that links the issue and the X post, follows Omarchy's PR standards, and runs the acceptance tests.
4. **Guardrails:** draft only, never merged by the bot, a cap on PRs per day, and a human review every time.
5. **X reply (optional):** "Proposed fix: <PR link>".

## Later: recommend plugins from the plugin marketplace

Some reports are already solved by a community plugin. The bot points people there.

1. **Source:** the catalog in [omacom/omarchy-plugin-marketplace](https://github.com/omacom/omarchy-plugin-marketplace), refreshed each run.
2. **Match:** the AI compares the post with each plugin's name and description and picks at most 3 that clearly fit, or none.
3. **Where it shows up:**
   - a "Plugins that might help" section in the issue or PR
   - the X reply, when reply keys are set
   - posts that aren't bugs (support or feature ideas), which can get a plugin suggestion instead of an issue
4. **Guardrails:** recommend only plugins listed in the marketplace, link to each one's page, and never install anything.

## Later: screenshots and video from the post

Many reports show the bug in an image instead of describing it.

1. **Read:** request `attachments.media_keys` with `media.fields=url,preview_image_url,type,alt_text`. Media comes in the same mentions call, so there are no extra reads.
2. **Issue:** embed each image (or a video's preview frame and link) under "What's wrong?".
3. **AI:** send the images to a vision model so it can read error text and settings shown in the screenshot.
4. **Guardrails:** link to X's own media URLs and don't re-host them. Never run or open anything else in the post.

## Later: follow-up questions in the X reply

The reply asks the reporter for what the issue is missing, so they can answer right on X.

1. **Questions:** the top 1 or 2 items from the issue's Missing info list (e.g. "Which browser were you using?"), plus a pointer to `omarchy-debug`.
2. **Safety:** the questions come from a fixed set of templates filled with plain words, never free AI text, so a crafted post can't make the bot say anything else. Fits within 280 characters with the issue link.
3. **Answers:** the bot reads replies to its own post on later runs and adds them to the issue as a comment, quoting the reporter.
4. **Guardrails:** one reply per post, only to the original reporter, and nothing if the issue is already closed.

## Replies and X's rules

X's API (since 2026-02-23) and automation rules only allow a reply when the post mentions or quotes the replying account, so the bot replies only from the account it watches. Replies are off on the running bot.

1. **@omarchy itself:** if omacom adopts the bot and connects the @omarchy account, it replies to its own mentions.
2. **Or a bot account:** set `X_HANDLE` and `X_ACCOUNT_ID` to the bot (e.g. @OmarchyBot); people tag it instead, and posts that tag only @omarchy aren't read.
3. **Rules:** mark the account Automated, honor opt-outs (`stop`, `unsubscribe`, `opt out`), and reply once per report.

