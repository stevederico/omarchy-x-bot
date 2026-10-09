<div align="center">

# omarchy-x-bot

### tag @omarchy on x, get a github issue. node 24, github actions, github models, zero deps

</div>

<br />

## 🚀 Quick Start

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
DRY_RUN=true X_BEARER_TOKEN=... node scripts/x-mentions-to-issues.mjs
```

A dry run prints each issue it would file, AI draft included, and writes nothing to GitHub.

<br />

## ✨ What's Included

### 🐦 **X Mentions**
- **Hourly read** of new @omarchy mentions at :23, plus a manual run button
- **Keyword filter** files only posts that say `bug`, `broken`, `fix`, or `issue`
- **Typed tags and plain replies** to @omarchy both count
- **Moving window** saves the last post read, so each run only pays for new posts

### 🤖 **AI-Written Issues**
- **Omarchy's bug template**: GitHub Models fills in System details and What's wrong?, and asks for `omarchy-debug` output
- **Bugs only**: support questions, ideas, and jokes are skipped
- **No guessing**: anything the post doesn't say is marked "Not mentioned"
- **Original post kept** under the report, with the author's name, @handle, and link
- **Falls back** to a plain issue if the model fails

### 🛡️ **Safety**
- **Dry run by default** on every scheduled run
- **Refuses `omacom/omarchy`**; files into a fork only
- **No X reply** unless an @omarchy token is set

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
AI_MODEL=xai/grok-3-mini             # any GitHub Models id
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

Each run reads mentions since `state/since_id.txt`, keeps the ones that match a keyword, and looks up only those authors. For each match, GitHub Models drafts the report, and the bot files it with the `bug`, `from-x`, and `needs-triage` labels. The workflow then commits the new `since_id`.

```
scripts/x-mentions-to-issues.mjs   # the loop
scripts/x.mjs                      # X API: mentions, authors, reply
scripts/ai.mjs                     # GitHub Models: write the issue
scripts/issue.mjs                  # filter, issue body, GitHub REST
state/since_id.txt                 # last post read
```

See `SPEC.md` for the full design and later ideas.

<br />

## 💸 Costs

| What | Cost |
|---|---|
| **X post read** | $0.005 per new mention |
| **X author lookup** | $0.01 per matched post only |
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
