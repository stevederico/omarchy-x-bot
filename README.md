<div align="center">

<img src="assets/banner.svg" alt="X to GitHub" width="100%" />

# omarchy-x-bot

### tag @omarchy on x, get a github issue. node 24, github actions, grok, zero deps

</div>

<br />

## 🚀 Quick Start

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
MODE=test X_BEARER_TOKEN=... XAI_API_KEY=... node scripts/x-mentions-to-issues.mjs
```

Test mode prints each issue it would file and writes nothing to GitHub. Without `XAI_API_KEY`, test mode prints plain draft issues and no AI draft. Live mode refuses to start without it.

<br />

## ✨ What's Included

### 🐦 **X Mentions**
- **Every 5 minutes**, a read of new @omarchy mentions, plus a manual run button with a test or live choice
- **Keyword filter** sends only posts that say `bug`, `broken`, `fix`, `issue`, `crash`, `error`, `not working`, or `doesn't work` to the AI (word starts, any case)
- **Typed tags and plain replies** to @omarchy both count
- **Moving window** saves the last post handled after each one, so each run only pays for new posts and a crash never files a post twice

### 🤖 **AI-Written Issues**
- **Omarchy's bug template**: Grok fills in What's wrong?, System details when the post has them, the likely area, steps to try, and a Missing info checklist
- **Bugs only**: support questions, ideas, and jokes are skipped and listed on the run's summary page
- **No made-up facts**: details the post doesn't give are left out and asked for in a Missing info checklist
- **Second pass**: Grok rewrites the issue after reading the matching upstream issues and the Omarchy codebase (AGENTS.md, files matching the bug, the user manual page), so it names real files and commands, the likely root cause, and any known workaround
- **Possibly related upstream**: a broad search of `omacom/omarchy` issues, then Grok picks up to 3 that match, listed as plain text so omacom gets no backlinks
- **Original post kept** under the AI summary, with the author's name, @handle, and link
- **Retries later** if the AI API fails in any way (rate limit, outage, timeout, bad key, retired model); the run goes red and nothing is filed without a verdict
- **Falls back** to a draft issue without the `bug` label if the model's answer is unusable

### 🛡️ **Safety**
- **Test mode by default**: only `MODE=live` files issues; unset or anything else just logs
- **Refuses `omacom/omarchy`**; files into a fork only
- **No X reply** unless the bot's own X account keys are set; the reply is a fixed message, never AI text
- **No GitHub pings**: @handles from X are broken so they never @mention GitHub users
- **Posts are untrusted**: the model is told never to follow them, and links it adds that aren't in the posts are removed

<br />

## ⚙️ Configuration

Secrets:

```bash
X_READ_TOKEN           # X bearer token; reads @omarchy mentions (passed as X_BEARER_TOKEN)
OMARCHY_X_BOT_TOKEN    # GitHub token with issues: write on the target repo
XAI_API_KEY            # xAI API key; Grok decides if a post is a bug and writes the issue
X_API_KEY              # optional, for replies: X app API key (OAuth 1.0a consumer key)
X_API_SECRET           # optional, for replies: X app API secret
X_REPLY_ACCESS_TOKEN   # optional, for replies: access token for the account that replies (yours or a bot's, not @omarchy)
X_REPLY_ACCESS_SECRET  # optional, for replies: that account's access token secret
```

Variables (optional):

```bash
TARGET_REPO=stevederico/omarchy      # where issues go
X_ACCOUNT_ID=2108454467309883392     # @omarchy
AI_MODEL=grok-4.20-non-reasoning     # any xAI model id; default is in scripts/ai.mjs
MODE=test                            # test logs only; live files issues and replies
```

GitHub Models was retired on July 30, 2026, so the AI is xAI's API, paid per token.

<br />

## 🧱 Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Node** | 24 | Runs the `.mjs` scripts, with built-in `fetch` and `node:test` |
| **GitHub Actions** | `ubuntu-latest` | 5-minute schedule, state cache, secrets, logs |
| **xAI API** | `grok-4.20-non-reasoning` | Decides bug or not, writes the issue |
| **X API** | v2, pay-per-use | Mentions, authors, optional reply |
| **GitHub REST API** | 2022-11-28 | Labels and issues |

Zero npm packages: no `dependencies`, no lockfile, no `npm ci`.

<br />

## 🏗️ Architecture

Each run restores `since_id` from the Actions cache and reads newer mentions, oldest first, and keeps the ones that match a keyword. For each match, Grok decides if it's a bug and drafts the report. The bot looks up the author only for posts it files, files them with the `bug`, `from-x`, and `needs-triage` labels, and saves `since_id` after each post. The workflow saves it back to the cache, even after a failed run, so nothing is committed. If the cache is ever lost, the bot skips any post that already has an issue.

```
scripts/x-mentions-to-issues.mjs   # the loop
scripts/x.mjs                      # X API: mentions, authors, reply
scripts/ai.mjs                     # xAI: decide and write the issue
scripts/issue.mjs                  # filter, issue body, GitHub REST
state/since_id.txt                 # last post handled (Actions cache, not in git)
```

See `SPEC.md` for the full design and later ideas.

<br />

## 💸 Costs

| What | Cost |
|---|---|
| **X post read** | $0.005 per new mention |
| **X author lookup** | $0.01 per filed post's author only |
| **GitHub Actions** | Free tier (unlimited if the repo is public) |
| **xAI API** | About $0.001 per matched post ($1.25/M in, $2.50/M out) |

<br />

## 🤝 Contributing

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
```

<br />

## 📄 License

MIT. See `LICENSE`.

<br />

<div align="center">

Built with Node, GitHub Actions, and Grok · [@stevederico](https://x.com/stevederico)

</div>
