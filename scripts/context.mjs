// What the second AI pass reads from omacom/omarchy: the related issues' bodies and a slice of the codebase.
import { GH, UPSTREAM, headers } from './issue.mjs'

const MAX_PATHS = 40

async function get(url, token, fetchImpl) {
  const res = await fetchImpl(url, { headers: headers(token) })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`)
  return res.json()
}

const decode = file => Buffer.from(file.content ?? '', 'base64').toString('utf8')

// The full bodies of the related upstream issues. Any one that fails is left as title only.
export async function withBodies({ related, token, repo = UPSTREAM, fetchImpl = fetch }) {
  return Promise.all(related.map(async r => {
    try {
      return { ...r, body: (await get(`${GH}/repos/${repo}/issues/${r.number}`, token, fetchImpl)).body ?? '' }
    } catch {
      return r
    }
  }))
}

/**
 * AGENTS.md, the repo paths that match the bug's keywords (real commands like bin/omarchy-toggle-idle),
 * and the first matching end-user manual page. Best effort: any part that fails is left out.
 */
export async function repoContext({ terms, token, repo = UPSTREAM, fetchImpl = fetch }) {
  const parts = []
  const words = String(terms ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2)
  try {
    parts.push(`AGENTS.md:\n${decode(await get(`${GH}/repos/${repo}/contents/AGENTS.md`, token, fetchImpl)).slice(0, 5000)}`)
  } catch {}
  try {
    const tree = (await get(`${GH}/repos/${repo}/git/trees/HEAD?recursive=1`, token, fetchImpl)).tree ?? []
    const paths = tree.filter(t => t.type === 'blob' && words.some(w => t.path.toLowerCase().includes(w))).map(t => t.path)
    if (paths.length) parts.push(`Files matching ${words.join(', ')}:\n${paths.slice(0, MAX_PATHS).join('\n')}`)
    const manual = paths.find(p => p.startsWith('manual/') && p.endsWith('.md'))
    if (manual) parts.push(`${manual}:\n${decode(await get(`${GH}/repos/${repo}/contents/${manual}`, token, fetchImpl)).slice(0, 3000)}`)
  } catch {}
  return parts.join('\n\n')
}
