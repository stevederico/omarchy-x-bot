# @omarchy X → GitHub Issue Bot: Prototype

**Goal:** prove the loop works once, end to end, with the least code.
Tag `@omarchy` on X → one draft issue appears in `omacom/omarchy` → `@omarchy` replies on X with the issue link.

## Scope
In: tag detection, one issue per tagged post, one reply.
Out: approval queue, rate limits, vouch, duplicate check, AI triage beyond a title, close-the-loop replies.

## Flow
1. Poll X for new mentions of `@omarchy` (`GET /2/users/2108454467309883392/mentions?since_id=…`).
2. For each new mention (skip @omarchy's own posts and reposts):
   - Title: `[X] ` + first 80 chars of the post text (or the parent post if the mention is a reply).
   - Body: author handle, post URL, quoted post text, footer "Filed automatically from X (prototype)."
   - Labels: `from-x`, `needs-triage`. No `bug` label: the repo's issues are for verified bugs only, so prototype issues are clearly marked as drafts.
3. Create the issue with `gh issue create --repo omacom/omarchy`.
4. Reply from `@omarchy`: "Tracked: <issue url>".
5. Save the newest mention id as `since_id`.

## Runtime
- One Node 24 `.mjs` script, `scripts/x-mentions-to-issues.mjs`, run by a GitHub Actions workflow on `schedule` (hourly, off the hour, e.g. `cron: '23 * * * *'`) plus `workflow_dispatch`.
- `since_id` stored as a repo variable or committed state file.
- Secrets: `X_BEARER_TOKEN` (read mentions), `X_OMARCHY_USER_TOKEN` (post the reply as @omarchy), `OMARCHY_BOT_TOKEN` (bot-account PAT with `issues: write`).

## Proving it works
- Tag @omarchy from a test account → within an hour an issue exists with the post link and @omarchy replied with the issue URL.
- Run it on a fork first (`stevederico/omarchy`) so no real issues are filed until the maintainers say yes.

## Context
- Org bots already run this way: plugin marketplace issue automation is GitHub Actions + Node 24 `.mjs` + `gh`/`jq`.
- omarchybot (semi-official reviewer, a regular bot account, not a GitHub App) is the natural owner of the token.
- Design doc lands as a PR to `omacom/omarchy` under `plans/x-issues.md`.
