<div align="center">

<img src="assets/banner.svg" alt="X to GitHub" width="100%" />

# omarchy-x-bot

### tag @omarchy on x, get a github issue. cloudflare workers, grok, zero deps

</div>

<br />

## 🚀 Quick Start

```bash
git clone https://github.com/stevederico/omarchy-x-bot && cd omarchy-x-bot
npm test
MODE=test X_BEARER_TOKEN=... XAI_API_KEY=... GH_TOKEN=... npm run mentions
```

A local test run prints each issue it would file and writes nothing to GitHub. Without `XAI_API_KEY` it prints plain draft issues, and live mode refuses to start. Without `GH_TOKEN` it skips the upstream search and repo context.

<br />

## ☁️ Deploy

```bash
npx wrangler login
npx wrangler kv namespace create STATE     # put the id in wrangler.toml
npx wrangler secret put X_BEARER_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put XAI_API_KEY
npm run deploy
```

Watch it with `npm run logs`. Set a `RUN_KEY` secret to run it on demand with `RUN_KEY=... npm run demo`.

<br />

## ✨ What's Included

### 🐦 **X Mentions**
- **Every minute**, an X search for new @omarchy mentions with a keyword (Cloudflare cron), plus a `POST /run` endpoint for demos
- **Pay only for matches**: X filters by keyword and skips reposts, so it never bills the rest of the mentions
- **One run at a time**: a Durable Object lock skips a tick while a slow run is still going, so nothing is filed twice
- **Keyword filter** keeps only posts that say `bug`, `broken`, `fix`, `issue`, `crash`, `error`, `fail`, `glitch`, `borked`, `freeze`, `hang`, `stuck`, `lag`, `not working`, `doesn't work`, `stopped working`, `won't start`, `won't boot`, `can't boot`, `black screen`, or `no sound`, plus common forms like `fixed` or `crashes` (the search query is capped at 512 characters)
- **Typed tags and plain replies** to @omarchy both count
- **Moving window**: each run reads only posts newer than the last one handled, so old posts are never paid for twice, and the position is saved even when a run fails

### 🤖 **AI-Written Issues**
- **Omarchy's bug template**: Grok fills in What's wrong?, System details when the post has them, the likely area, steps to try, and a Missing info checklist
- **Bugs only**: support questions, ideas, and jokes are skipped and listed in the Worker logs
- **No made-up facts**: details the post doesn't give are left out and asked for in a Missing info checklist
- **Second pass**: Grok rewrites the issue after reading the matching upstream issues and the Omarchy codebase (AGENTS.md, files matching the bug, the user manual page), so it names real files and commands, the likely root cause, and any known workaround
- **Possibly related upstream**: a broad search of `omacom/omarchy` issues, then Grok picks up to 3 that match, listed as plain text so omacom gets no backlinks
- **Original post kept** under the AI summary, with the author's name, @handle, and link
- **Retries later** if the AI API fails in any way (rate limit, outage, timeout, bad key, retired model); nothing is filed without a verdict
- **Falls back** to a draft issue without the `bug` label if the model's answer is unusable

### 🛡️ **Safety**
- **Test mode by default**: only `MODE=live` files issues; unset or anything else just logs
- **Refuses `omacom/omarchy`**; files into a fork only
- **No X replies**: X only allows them to posts that tag the replying account, so they're off (see below); when on, the reply is a fixed message, never AI text
- **No GitHub pings**: @handles from X are broken so they never @mention GitHub users
- **Posts are untrusted**: the model is told never to follow them, and links it adds that aren't in the posts are removed

<br />

## ⚙️ Configuration

Secrets, set with `npx wrangler secret put NAME`:

```bash
X_BEARER_TOKEN         # X app bearer token; searches @omarchy mentions
GITHUB_TOKEN           # fine-grained GitHub token: Issues read and write on TARGET_REPO
XAI_API_KEY            # xAI API key; Grok decides if a post is a bug and writes the issue
RUN_KEY                # optional: any random string; enables POST /run for demos
X_API_KEY              # optional, for replies: X app API key (OAuth 1.0a consumer key)
X_API_SECRET           # optional, for replies: X app API secret
X_REPLY_ACCESS_TOKEN   # optional, for replies: access token for the account that replies (a bot's, not @omarchy)
X_REPLY_ACCESS_SECRET  # optional, for replies: that account's access token secret
```

### 💬 Replies on X

Reply support is built in and off by default. With the four reply secrets set, the bot answers each filed post with a fixed message: the issue link and an ask for the Omarchy version, the app, and `omarchy-debug` output. It's never AI text.

Since February 2026, X's API only accepts a reply when the post tags the replying account, and its automation rules only allow replies people asked for. So replies work in two setups:

- **@omarchy replies:** the Omarchy team connects the @omarchy account, so posts that tag @omarchy get answers from it
- **A bot account replies:** people tag the bot (e.g. @OmarchyBot), and the bot watches that account's mentions (set `X_HANDLE` and `X_ACCOUNT_ID` to it)

To connect an account, run `npm run connect`: it asks for your X app's API key and secret, gives you a link to authorize as that account, takes the PIN, and saves all four reply secrets to the Worker.

Variables, in `wrangler.toml`:

```bash
MODE=live                            # anything but live only logs
TARGET_REPO=stevederico/omarchy      # where issues go
X_HANDLE=omarchy                     # the account people tag
X_ACCOUNT_ID=2108454467309883392     # its id
AI_MODEL=grok-4.20-non-reasoning     # optional; any xAI model id
```

`since_id` lives in the `STATE` KV namespace and the one-run lock in the `RunLock` Durable Object. The AI is xAI's API, paid per token.

<br />

## 🧱 Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Cloudflare Workers** | cron, KV, Durable Objects | Runs the bot every minute, keeps `since_id`, one-run lock, secrets, logs |
| **Node** | 24 | Tests with `node:test`, and local runs |
| **xAI API** | `grok-4.20-non-reasoning` | Decides bug or not, writes the issue |
| **X API** | v2, pay-per-use | Mentions, authors, optional reply |
| **GitHub REST API** | 2022-11-28 | Labels and issues |

Zero npm packages: no `dependencies`, no lockfile, no `npm ci`.

<br />

## 🏗️ Architecture

Each run reads `since_id` from KV and searches X for newer @omarchy posts with a keyword, oldest first. Search only reaches back 7 days, so after 6 days with no match it starts 6 days back instead. For each match, Grok decides if it's a bug and drafts the report. The bot looks up the author only for posts it files, files them with the `bug`, `from-x`, and `needs-triage` labels, and tracks `since_id` after each post. The Worker writes it back to KV once per run, even after a failed run. If KV is ever lost, the bot skips any post that already has an issue.

```
worker/index.js                    # Cloudflare Worker: cron, KV state, POST /run
scripts/bot.mjs                    # the loop
scripts/x-mentions-to-issues.mjs   # run once from Node (state in state/since_id.txt)
scripts/x-connect.mjs              # link the bot's own X account for replies
scripts/x.mjs                      # X API: search mentions, authors, reply
scripts/ai.mjs                     # xAI: decide and write the issue
scripts/issue.mjs                  # filter, issue body, GitHub REST
scripts/context.mjs                # related issue bodies and Omarchy repo context
```

See `SPEC.md` for the full design and later ideas.

<br />

## 💸 Costs

| What | Cost |
|---|---|
| **X post read** | $0.005 per new mention with a keyword (others aren't returned or billed) |
| **X author lookup** | $0.01 per filed post's author only |
| **Cloudflare Workers** | Free plan: cron every minute, KV (one write per run with new posts), Durable Object lock |
| **xAI API** | About $0.001 per skipped match, about $0.005 per filed issue (three Grok calls) |

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

Built with Cloudflare Workers and Grok · [@stevederico](https://x.com/stevederico)

</div>
