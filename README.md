<div align="center">

# omarchy-x-bot

### tag @omarchy on x, get a github issue. node 24, github actions, github models, zero deps

</div>

<br />

## 🚀 Quick Start

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
DRY_RUN=true X_BEARER_TOKEN=... MODELS_TOKEN=$(gh auth token) node scripts/x-mentions-to-issues.mjs
```

A dry run prints each issue it would file and writes nothing to GitHub. `MODELS_TOKEN` is any GitHub token with Models access. Without it, you get plain draft issues and no AI draft.

<br />

## ✨ What's Included

### 🐦 **X Mentions**
- **Hourly read** of new @omarchy mentions at :23, plus a manual run button
- **Keyword filter** files only posts that say `bug`, `broken`, `fix`, or `issue`
- **Typed tags and plain replies** to @omarchy both count
- **Moving window** saves the last post handled after each one, so each run only pays for new posts and a crash never files a post twice

### 🤖 **AI-Written Issues**
- **Omarchy's bug template**: GitHub Models fills in System details and What's wrong?, and asks for `omarchy-debug` output
- **Bugs only**: support questions, ideas, and jokes are skipped and listed in `state/skipped.txt`
- **No guessing**: anything the post doesn't say is marked "Not mentioned"
- **Original post kept** under the AI summary, with the author's name, @handle, and link
- **Retries later** if the model is rate-limited, down, or slow; nothing is filed without a verdict
- **Falls back** to a draft issue without the `bug` label if the model's answer is unusable

### 🛡️ **Safety**
- **Dry run by default** on every scheduled run
- **Refuses `omacom/omarchy`**; files into a fork only
- **No X reply** unless an @omarchy token is set
- **No GitHub pings**: @handles from X are broken so they never @mention GitHub users
- **Posts are untrusted**: the model is told never to follow them, and links it adds that aren't in the posts are removed

<br />

## ⚙️ Configuration

Secrets:

```bash
X_READ_TOKEN           # X bearer token; reads @omarchy mentions (passed as X_BEARER_TOKEN)
OMARCHY_X_BOT_TOKEN    # GitHub token with issues: write on the target repo
X_OMARCHY_USER_TOKEN   # optional; @omarchy user token to reply "Tracked: <issue>"
```

Variables (optional):

```bash
TARGET_REPO=stevederico/omarchy      # where issues go
X_ACCOUNT_ID=2108454467309883392     # @omarchy
AI_MODEL=xai/grok-3-mini             # any GitHub Models id; default is in scripts/ai.mjs
DRY_RUN=true                         # set to false to go live
```

The workflow's built-in `GITHUB_TOKEN` (with `models: read`) pays for the AI, so there's no AI key to manage.

<br />

## 🧱 Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Node** | 24 | Runs the `.mjs` scripts, with built-in `fetch` and `node:test` |
| **GitHub Actions** | `ubuntu-latest` | Hourly schedule, secrets, logs |
| **GitHub Models** | `xai/grok-3-mini` | Writes the issue |
| **X API** | v2, pay-per-use | Mentions, authors, optional reply |
| **GitHub REST API** | 2022-11-28 | Labels and issues |

Zero npm packages: no `dependencies`, no lockfile, no `npm ci`.

<br />

## 🏗️ Architecture

Each run reads mentions since `state/since_id.txt`, oldest first, and keeps the ones that match a keyword. For each match, GitHub Models decides if it's a bug and drafts the report. The bot looks up the author only for posts it files, files them with the `bug`, `from-x`, and `needs-triage` labels, and saves `since_id` after each post. The workflow commits `state/`, even after a failed run.

```
scripts/x-mentions-to-issues.mjs   # the loop
scripts/x.mjs                      # X API: mentions, authors, reply
scripts/ai.mjs                     # GitHub Models: write the issue
scripts/issue.mjs                  # filter, issue body, GitHub REST
state/since_id.txt                 # last post handled
state/skipped.txt                  # posts the AI said aren't bugs
```

See `SPEC.md` for the full design and later ideas.

<br />

## 💸 Costs

| What | Cost |
|---|---|
| **X post read** | $0.005 per new mention |
| **X author lookup** | $0.01 per filed post's author only |
| **GitHub Actions** | Free tier (unlimited if the repo is public) |
| **GitHub Models** | Free, within rate limits |

<br />

## 🤝 Contributing

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
```

<br />

<div align="center">

Built with Node, GitHub Actions, and GitHub Models · [@stevederico](https://x.com/stevederico)

</div>
