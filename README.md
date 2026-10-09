# omarchy-x-bot (prototype)

Tag `@omarchy` on X → one issue in a **test fork** → `@omarchy` replies "Tracked: <issue url>".
Prototype only: no approval, rate limits, vouch, or duplicate check. See `SPEC.md`.

## Layout
```
.github/workflows/x-mentions.yml   # hourly at :23 + manual run (dry run by default)
scripts/x-mentions-to-issues.mjs   # the loop
scripts/x.mjs                      # X API: mentions, reply
scripts/issue.mjs                  # post -> issue, gh issue create
state/since_id.txt                 # newest mention handled
test/issue.test.mjs                # node --test
```

## Setup
Secrets:
- `X_BEARER_TOKEN`: reads @omarchy mentions
- `X_OMARCHY_USER_TOKEN`: OAuth 2.0 user token for @omarchy (`tweet.write`), to reply
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
