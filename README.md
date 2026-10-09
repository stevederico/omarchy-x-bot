# omarchy-x-bot (prototype)

Tag `@omarchy` on X → one issue in a **test fork** → `@omarchy` replies "Tracked: <issue url>".
Prototype only: no approval, rate limits, vouch, or duplicate check. See `SPEC.md`.

## Layout
```
.github/workflows/x-mentions.yml   # hourly at :23 + manual run (dry run by default)
scripts/x-mentions-to-issues.mjs   # the loop
scripts/x.mjs                      # X API: mentions, reply
scripts/issue.mjs                  # post -> issue, GitHub REST via fetch
state/since_id.txt                 # newest mention handled
test/issue.test.mjs                # node --test
```

## Setup
Secrets:
- `X_READ_TOKEN` (passed to the script as `X_BEARER_TOKEN`): reads @omarchy mentions
- `X_OMARCHY_USER_TOKEN` (optional): OAuth 2.0 user token for @omarchy (`tweet.write`). If it's unset, the bot files issues and skips the "Tracked:" reply on X
- `OMARCHY_X_BOT_TOKEN`: bot account PAT with `issues: write` on the target repo

Variables (optional):
- `TARGET_REPO` (default `stevederico/omarchy`). The script refuses `omacom/omarchy`.
- `X_ACCOUNT_ID` (default @omarchy, `2108454467309883392`)
- `DRY_RUN` (`true` until you set it to `false`)

## Run
```
npm test
DRY_RUN=true X_BEARER_TOKEN=... node scripts/x-mentions-to-issues.mjs
```

## Dependencies
**Zero npm packages.** `package.json` has no `dependencies` or `devDependencies`, and there is no lockfile or `npm ci` step.

| What | Where it comes from | Why |
|---|---|---|
| Node 24 | `actions/setup-node` | Runs the `.mjs` scripts |
| `fetch` | Node 24 built-in | X API (read mentions, post reply) and GitHub REST API (create labels, create issue) |
| `node:fs` | Node built-in | Read and write `state/since_id.txt` |
| `node:test`, `node:assert` | Node built-in | Tests |
| `git` | GitHub-hosted runner | Commit the updated `since_id` |
| `actions/checkout`, `actions/setup-node` | GitHub Actions | Standard workflow steps, not npm packages |

Not used: `twitter-api-sdk`, `@octokit/*`, or any other library. The `gh` CLI and `jq` aren't needed either, since everything goes through `fetch`.

## Filter
A mention is filed if it contains `bug`, `broken`, `fix`, or `issue`. That covers both posts that type `@omarchy` and plain replies to @omarchy's posts. The list is `KEYWORDS` in `scripts/issue.mjs`.
