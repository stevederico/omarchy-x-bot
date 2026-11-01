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

// Funnel stages for the window in funnel.json. Every bug or feature Grok finds is filed, so they are one step.
export function toFunnel(counts, issues) {
  const inRange = issues.filter(i => i.createdAt >= counts.start && i.createdAt < counts.end)
  const features = inRange.filter(i => kindOf(i) === 'feature').length
  return {
    start: counts.start,
    end: counts.end,
    stages: [
      { label: 'Mentions', value: counts.mentions },
      { label: 'Keyword matches', value: counts.keywordMatches },
      { label: 'Issues filed', sub: `${inRange.length - features} bugs · ${features} features`, value: inRange.length },
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
:root { --bg:#fafafa; --fg:#111; --muted:#777; --card:#fff; --line:#e4e4e4; --accent:#2a78d6; --track:#e9e9e9; --bug:#d6453d; --feature:#2f9e5b; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#888; --card:#1a1a1a; --line:#2a2a2a; --accent:#3987e5; --track:#242424; --bug:#ff6b61; --feature:#4cc27c; } }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; }
main { max-width:760px; margin:40px auto; padding:0 16px; }
h1 { font-size:22px; margin:0 0 24px; }
h2 { font-size:17px; margin:0; }
section { margin-bottom:40px; }
.head { display:flex; align-items:baseline; gap:12px; margin-bottom:14px; }
.muted { color:var(--muted); }
.head label { margin-left:auto; color:var(--muted); font-size:14px; }
.funnel { display:grid; grid-template-columns:repeat(var(--n), 1fr); gap:8px; }
.step { display:flex; flex-direction:column; min-width:0; }
.plot { position:relative; height:240px; display:flex; flex-direction:column; justify-content:flex-end; border-bottom:1px solid var(--line); }
.plot .val { font-weight:600; font-variant-numeric:tabular-nums; text-align:center; margin-bottom:4px; }
.ghost { background:var(--accent); opacity:.14; border-radius:4px 4px 0 0; }
.ghost + .bar { border-radius:0; }
.bar { background:var(--accent); border-radius:4px 4px 0 0; min-height:2px; }
.step .name { font-weight:600; font-size:13px; margin-top:8px; }
.step small { display:block; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.step:hover .bar { filter:brightness(1.12); }
#tip { position:fixed; pointer-events:none; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; box-shadow:0 4px 16px rgba(0,0,0,.12); display:none; z-index:9; }
#tip b { font-variant-numeric:tabular-nums; }
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
@media (max-width:520px) { .funnel { gap:4px; } .step .name { font-size:11px; } .plot { height:200px; } }
</style>
</head>
<body>
<main>
<h1>@omarchy</h1>
<section>
  <div class="head"><h2>Funnel</h2><span class="muted">${esc(day(funnel.start))} – ${esc(day(funnel.end))}</span></div>
  <div id="funnel" class="funnel"></div>
  <div id="tip"></div>
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
  const pctOf = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '0%'
  const el = document.getElementById('funnel')
  el.style.setProperty('--n', stages.length)
  // Mixpanel-style columns: solid = reached this step, faded = dropped since the step before.
  el.innerHTML = stages.map((s, i) => {
    const prev = i ? stages[i - 1].value : s.value
    const h = v => (v / max * 100) + '%'
    return '<div class="step" data-i="' + i + '"><div class="plot">' +
      '<div class="val">' + s.value.toLocaleString() + '</div>' +
      (i && prev > s.value ? '<div class="ghost" style="height:' + h(prev - s.value) + '"></div>' : '') +
      '<div class="bar" style="height:' + h(s.value) + '"></div></div>' +
      '<div class="name">' + s.label + '</div>' +
      '<small>' + (i ? pctOf(s.value, prev) : '100%') + '</small>' +
      (s.sub ? '<small>' + s.sub + '</small>' : '') + '</div>'
  }).join('')
  const tip = document.getElementById('tip')
  el.querySelectorAll('.step').forEach(node => {
    const i = +node.dataset.i, s = stages[i], prev = i ? stages[i - 1].value : s.value
    node.onmousemove = e => {
      tip.innerHTML = '<div>' + s.label + '</div><b>' + s.value.toLocaleString() + '</b>' +
        '<div>' + pctOf(s.value, stages[0].value) + ' of mentions</div>' +
        (i ? '<div>' + pctOf(s.value, prev) + ' of previous · ' + (prev - s.value).toLocaleString() + ' dropped</div>' : '')
      tip.style.display = 'block'
      tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'
      tip.style.top = (e.clientY + 12) + 'px'
    }
    node.onmouseleave = () => { tip.style.display = 'none' }
  })
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
