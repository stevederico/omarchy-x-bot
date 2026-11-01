// Reply queue: open from-x issues on TARGET_REPO, each with a one-click X reply that you send by hand.
// Replies stay manual, so X never sees an automated reply. Needs the gh CLI, signed in.
// Usage: npm run queue [-- --out path.html] [--no-open]
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replyText } from './bot.mjs'

const POST_RE = /on X: https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// The quoted post is the "> " block after the "on X:" line.
const quoteOf = body => {
  const lines = body.split('\n')
  const at = lines.findIndex(l => POST_RE.test(l))
  if (at < 0) return ''
  return lines.slice(at + 1).filter(l => l.startsWith('>')).map(l => l.replace(/^> ?/, '')).join('\n').replace(/@​/g, '@').trim()
}

// gh issue JSON -> queue items; issues without an X post link are left out.
export function toQueue(issues) {
  return issues.flatMap(i => {
    const m = i.body?.match(POST_RE)
    if (!m) return []
    const kind = i.labels.some(l => l.name === 'enhancement') ? 'feature' : 'bug'
    const text = replyText(i.url, kind)
    return [{
      number: i.number,
      title: i.title,
      issueUrl: i.url,
      kind,
      handle: m[1],
      postId: m[2],
      postUrl: `https://x.com/${m[1]}/status/${m[2]}`,
      quote: quoteOf(i.body),
      createdAt: i.createdAt,
      replyUrl: `https://x.com/intent/post?${new URLSearchParams({ in_reply_to: m[2], text })}`
    }]
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function queueHtml(items, repo) {
  const rows = items.map(q => `
<article data-id="${esc(q.postId)}">
  <label class="done"><input type="checkbox"></label>
  <div class="main">
    <div class="meta"><span class="kind ${q.kind}">${q.kind}</span><a href="${esc(q.issueUrl)}">#${q.number}</a><a href="${esc(q.postUrl)}">@${esc(q.handle)}</a><time>${esc(q.createdAt.slice(0, 10))}</time></div>
    <h2>${esc(q.title)}</h2>
    <blockquote>${esc(q.quote)}</blockquote>
  </div>
  <a class="reply" href="${esc(q.replyUrl)}" target="_blank" rel="noopener">Reply</a>
</article>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reply queue</title>
<style>
:root { --bg:#fafafa; --fg:#111; --muted:#777; --card:#fff; --line:#e4e4e4; --accent:#2f6fed; --bug:#d6453d; --feature:#2f9e5b; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#888; --card:#1a1a1a; --line:#2a2a2a; --accent:#5b8cff; --bug:#ff6b61; --feature:#4cc27c; } }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; }
main { max-width:760px; margin:40px auto; padding:0 16px; }
header { display:flex; align-items:baseline; gap:12px; margin-bottom:20px; }
h1 { font-size:20px; margin:0; }
#count { color:var(--muted); }
header label { margin-left:auto; color:var(--muted); font-size:14px; }
article { display:grid; grid-template-columns:28px 1fr auto; gap:12px; align-items:start; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; margin:10px 0; }
article.is-done { opacity:.45; }
body.hide-done article.is-done { display:none; }
.done input { width:18px; height:18px; margin-top:2px; }
.meta { display:flex; gap:10px; font-size:13px; color:var(--muted); flex-wrap:wrap; }
.meta a { color:var(--muted); }
.kind { font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:.04em; }
.kind.bug { color:var(--bug); } .kind.feature { color:var(--feature); }
h2 { font-size:16px; margin:4px 0 6px; }
blockquote { margin:0; color:var(--muted); white-space:pre-wrap; word-break:break-word; font-size:14px; }
.reply { background:var(--accent); color:#fff; text-decoration:none; padding:7px 14px; border-radius:8px; font-weight:600; }
</style>
</head>
<body>
<main>
<header><h1>Reply queue</h1><span id="count"></span><label><input type="checkbox" id="hide"> Hide done</label></header>
${rows || '<p>Empty</p>'}
</main>
<script>
const KEY = 'reply-queue:${esc(repo)}'
let done = {}
try { done = JSON.parse(localStorage.getItem(KEY)) || {} } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(done)) } catch {} }
const cards = [...document.querySelectorAll('article')]
const count = () => { document.getElementById('count').textContent = cards.filter(c => !done[c.dataset.id]).length + ' to reply' }
for (const c of cards) {
  const box = c.querySelector('.done input')
  const set = v => { box.checked = v; c.classList.toggle('is-done', v); if (v) done[c.dataset.id] = 1; else delete done[c.dataset.id]; save(); count() }
  set(!!done[c.dataset.id])
  box.addEventListener('change', () => set(box.checked))
  c.querySelector('.reply').addEventListener('click', () => set(true))
}
const hide = document.getElementById('hide')
try { hide.checked = localStorage.getItem(KEY + ':hide') === '1' } catch {}
const applyHide = () => { document.body.classList.toggle('hide-done', hide.checked); try { localStorage.setItem(KEY + ':hide', hide.checked ? '1' : '0') } catch {} }
hide.addEventListener('change', applyHide); applyHide(); count()
</script>
</body>
</html>
`
}

const repoFromToml = () => readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').match(/TARGET_REPO\s*=\s*"([^"]+)"/)?.[1]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : fileURLToPath(new URL('../state/reply-queue.html', import.meta.url))
  const repo = process.env.TARGET_REPO || repoFromToml()
  if (!repo || repo.toLowerCase() === 'omacom/omarchy') throw new Error('TARGET_REPO must be your fork')
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', repo, '-l', 'from-x', '--state', 'open', '--limit', '500', '--json', 'number,title,url,body,labels,createdAt'], { encoding: 'utf8' }))
  const items = toQueue(issues)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, queueHtml(items, repo))
  console.log(`${items.length} to reply: ${out}`)
  if (!args.includes('--no-open')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [out], { detached: true, stdio: 'ignore' }).unref()
}
