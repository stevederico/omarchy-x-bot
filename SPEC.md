# @omarchy X → GitHub Issue Bot: Prototype

**Goal:** prove the loop works once, end to end, with the least code.
Tag `@omarchy` on X → one draft issue appears in `omacom/omarchy` → `@omarchy` replies on X with the issue link.

## Scope
In: tag detection, one issue per tagged post, one reply.
In: AI drafting in Omarchy's bug template, and skipping posts the AI says aren't bugs.
Out: approval queue, rate limits, vouch, duplicate check, close-the-loop replies.

## Flow
1. Poll X for new mentions of `@omarchy` (`GET /2/users/2108454467309883392/mentions?since_id=…`).
2. For each new mention with a keyword (skip @omarchy's own posts), oldest first, Grok (xAI API) reads the post and its parent as untrusted text and decides:
   - **Bug:** title (under 80 chars) and body in the bug template, marked as an AI summary, with links not in the posts removed. Labels: `bug`, `from-x`, `needs-triage`.
   - **Not a bug:** no issue. The post URL is added to `state/skipped.txt` so it can be reviewed or replayed.
   - **No verdict** (unusable answer, or no key in test mode): a draft issue titled `[X] ` + first 80 chars of the post (or its parent). Labels: `from-x`, `needs-triage`. No `bug` label, since nothing checked it.
   - **AI API fails** (rate limit, outage, timeout, bad key, retired model, non-JSON reply): stop the run and fail the job. The next run retries from this post. A live run refuses to start without `XAI_API_KEY`.
   - Every issue body keeps the author handle, post URL, quoted post text, and the footer "Filed automatically from X (prototype)."
3. Look up the author only for posts being filed, and create the issue with the GitHub REST API.
4. Reply from `@omarchy`: "Tracked: <issue url>". A failed reply is logged and doesn't stop the run.
5. Save `since_id` after each post, so a crash midway never files a post twice. The workflow commits `state/` even when the run fails.

## Runtime
- One Node 24 `.mjs` script, `scripts/x-mentions-to-issues.mjs`, run by a GitHub Actions workflow on `schedule` (hourly, off the hour, e.g. `cron: '23 * * * *'`) plus `workflow_dispatch`.
- `since_id` stored as a repo variable or committed state file.
- Secrets: `X_READ_TOKEN` (read mentions), `X_OMARCHY_USER_TOKEN` (post the reply as @omarchy), `OMARCHY_X_BOT_TOKEN` (bot-account PAT with `issues: write`). `XAI_API_KEY` (Grok). GitHub Models was retired on 2026-07-30.

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
   - the X reply, when there's an @omarchy token
   - posts that aren't bugs (support or feature ideas), which can get a plugin suggestion instead of an issue
4. **Guardrails:** recommend only plugins listed in the marketplace, link to each one's page, and never install anything.

## Later: screenshots and video from the post

Many reports show the bug in an image instead of describing it.

1. **Read:** request `attachments.media_keys` with `media.fields=url,preview_image_url,type,alt_text`. Media comes in the same mentions call, so there are no extra reads.
2. **Issue:** embed each image (or a video's preview frame and link) under "What's wrong?".
3. **AI:** send the images to a vision model so it can read error text and settings shown in the screenshot.
4. **Guardrails:** link to X's own media URLs and don't re-host them. Never run or open anything else in the post.
