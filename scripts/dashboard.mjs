// Dashboard: the @omarchy funnel plus the reply queue, one local page.
// Funnel: X counts from pages/funnel.json (mentions, keyword matches), issues counted live from TARGET_REPO.
// Queue: open from-x issues, each with a one-click X reply you send by hand, so X never sees an automated reply.
// Needs the gh CLI, signed in. Usage: npm run dashboard [-- --out path.html] [--no-open]
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replyText } from './bot.mjs'

const POST_RE = /on X: https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const kindOf = i => i.labels.some(l => l.name === 'enhancement') ? 'feature' : 'bug'

// The quoted post is the "> " block after the "on X:" line.
const quoteOf = body => {
  const lines = body.split('\n')
  const at = lines.findIndex(l => POST_RE.test(l))
  if (at < 0) return ''
  return lines.slice(at + 1).filter(l => l.startsWith('>')).map(l => l.replace(/^> ?/, '')).join('\n').replace(/@​/g, '@').trim()
}

// gh issue JSON -> queue items, newest first; issues without an X post link are left out.
export function toQueue(issues) {
  return issues.flatMap(i => {
    if (i.state && i.state !== 'OPEN') return []
    const m = i.body?.match(POST_RE)
    if (!m) return []
    const kind = kindOf(i)
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
      replyUrl: `https://x.com/intent/post?${new URLSearchParams({ in_reply_to: m[2], text: replyText(i.url, kind) })}`
    }]
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Funnel stages for the window in funnel.json. Bugs and features = issues filed in the window.
export function toFunnel(counts, issues) {
  const inRange = issues.filter(i => i.createdAt >= counts.start && i.createdAt < counts.end)
  const features = inRange.filter(i => kindOf(i) === 'feature').length
  return {
    start: counts.start,
    end: counts.end,
    stages: [
      { label: 'Mentions', value: counts.mentions },
      { label: 'Keyword matches', value: counts.keywordMatches },
      { label: 'Bugs & features', sub: `${inRange.length - features} bugs · ${features} features`, value: inRange.length },
      { label: 'Issues filed', value: inRange.length },
      { label: 'Replies sent', value: null }
    ]
  }
}

const day = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function dashboardHtml({ items, funnel, repo }) {
  const rows = items.map(q => `
<article data-id="${esc(q.postId)}" data-created="${esc(q.createdAt)}">
  <label class="done"><input type="checkbox"></label>
  <div class="main">
    <div class="meta"><span class="kind ${q.kind}">${q.kind}</span><a href="${esc(q.issueUrl)}">#${q.number}</a><a href="${esc(q.postUrl)}">@${esc(q.handle)}</a><time>${esc(q.createdAt.slice(0, 10))}</time></div>
    <h3>${esc(q.title)}</h3>
    <blockquote>${esc(q.quote)}</blockquote>
  </div>
  <a class="reply" href="${esc(q.replyUrl)}" target="_blank" rel="noopener">Reply</a>
</article>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>omarchy-x-bot</title>
<style>
:root { --bg:#fafafa; --fg:#111; --muted:#777; --card:#fff; --line:#e4e4e4; --accent:#2f6fed; --track:#e9e9e9; --bug:#d6453d; --feature:#2f9e5b; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#888; --card:#1a1a1a; --line:#2a2a2a; --accent:#5b8cff; --track:#242424; --bug:#ff6b61; --feature:#4cc27c; } }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; }
main { max-width:760px; margin:40px auto; padding:0 16px; }
h1 { font-size:22px; margin:0 0 24px; }
h2 { font-size:17px; margin:0; }
section { margin-bottom:40px; }
.head { display:flex; align-items:baseline; gap:12px; margin-bottom:14px; }
.muted { color:var(--muted); }
.head label { margin-left:auto; color:var(--muted); font-size:14px; }
.row { display:grid; grid-template-columns:150px 1fr 70px; gap:12px; align-items:center; margin:12px 0; }
.label { font-weight:600; }
.label small, .num small { display:block; font-weight:400; color:var(--muted); }
.track { background:var(--track); border-radius:6px; height:30px; display:flex; }
.bar { background:var(--accent); border-radius:6px; height:100%; min-width:4px; }
.num { text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
article { display:grid; grid-template-columns:28px 1fr auto; gap:12px; align-items:start; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; margin:10px 0; }
article.is-done { opacity:.45; }
body.hide-done article.is-done { display:none; }
.done input { width:18px; height:18px; margin-top:2px; }
.meta { display:flex; gap:10px; font-size:13px; color:var(--muted); flex-wrap:wrap; }
.meta a { color:var(--muted); }
.kind { font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:.04em; }
.kind.bug { color:var(--bug); } .kind.feature { color:var(--feature); }
h3 { font-size:16px; margin:4px 0 6px; }
blockquote { margin:0; color:var(--muted); white-space:pre-wrap; word-break:break-word; font-size:14px; }
.reply { background:var(--accent); color:#fff; text-decoration:none; padding:7px 14px; border-radius:8px; font-weight:600; }
@media (max-width:520px) { .row { grid-template-columns:110px 1fr 56px; } }
</style>
</head>
<body>
<main>
<h1>@omarchy</h1>
<section>
  <div class="head"><h2>Funnel</h2><span class="muted">${esc(day(funnel.start))} – ${esc(day(funnel.end))}</span></div>
  <div id="funnel"></div>
</section>
<section>
  <div class="head"><h2>Reply queue</h2><span class="muted" id="count"></span><label><input type="checkbox" id="hide"> Hide done</label></div>
  ${rows || '<p class="muted">Empty</p>'}
</section>
</main>
<script>
const FUNNEL = ${JSON.stringify(funnel).replace(/</g, '\\u003c')}
const KEY = ${JSON.stringify(`reply-queue:${repo}`).replace(/</g, '\\u003c')}
let done = {}
try { done = JSON.parse(localStorage.getItem(KEY)) || {} } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(done)) } catch {} }
const cards = [...document.querySelectorAll('article')]

function drawFunnel() {
  // Replies sent: posts from the funnel window you've marked replied in this browser.
  const replied = cards.filter(c => done[c.dataset.id] && c.dataset.created >= FUNNEL.start && c.dataset.created < FUNNEL.end).length
  const stages = FUNNEL.stages.map(s => s.value === null ? { ...s, value: replied } : s)
  const max = stages[0].value || 1
  document.getElementById('funnel').innerHTML = stages.map((s, i) => {
    const prev = i && stages[i - 1].value
    const pct = i ? (prev ? (s.value / prev * 100).toFixed(1) : '0.0') + '%' : ''
    return '<div class="row"><div class="label">' + s.label + (s.sub ? '<small>' + s.sub + '</small>' : '') + '</div>' +
      '<div class="track"><div class="bar" style="width:' + Math.max(s.value / max * 100, 0.5) + '%"></div></div>' +
      '<div class="num">' + s.value.toLocaleString() + (pct ? '<small>' + pct + '</small>' : '') + '</div></div>'
  }).join('')
}
const count = () => { document.getElementById('count').textContent = cards.filter(c => !done[c.dataset.id]).length + ' to reply'; drawFunnel() }
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
  const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : fileURLToPath(new URL('../pages/dashboard.html', import.meta.url))
  const repo = process.env.TARGET_REPO || repoFromToml()
  if (!repo || repo.toLowerCase() === 'omacom/omarchy') throw new Error('TARGET_REPO must be your fork')
  const counts = JSON.parse(readFileSync(new URL('../pages/funnel.json', import.meta.url), 'utf8'))
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', repo, '-l', 'from-x', '--state', 'all', '--limit', '1000', '--json', 'number,title,url,body,labels,createdAt,state'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
  const items = toQueue(issues)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, dashboardHtml({ items, funnel: toFunnel(counts, issues), repo }))
  console.log(`${items.length} to reply: ${out}`)
  if (!args.includes('--no-open')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [out], { detached: true, stdio: 'ignore' }).unref()
}
