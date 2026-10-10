// Minimal X API v2 client: search mentions, post a reply.
import { createHmac, randomBytes } from 'node:crypto'

const API = 'https://api.x.com/2'

const DAY = 86_400_000
// X ids carry the time they were made (ms since X's epoch, shifted left 22 bits).
const EPOCH = 1288834974657n
export const idTime = id => Number((BigInt(id) >> 22n) + EPOCH)
// The lowest id X could give a post made at `ms`, so until_id can stand in for a time.
export const idAt = ms => String((BigInt(ms) - EPOCH) << 22n)

// Newest first, like X returns them. Ids are numbers too long for JS, so compare by length, then text.
const byIdDesc = (a, b) => b.id.length - a.id.length || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)

// Recent search, so X only returns (and bills) posts that match a query, not every mention. Several queries
// (keywords split under X's length cap) are merged into one newest-first list, each post once.
export async function searchMentions({ queries, sinceId, bearer, fetchImpl = fetch, now = Date.now() }) {
  const base = {
    max_results: '100',
    'tweet.fields': 'author_id,created_at,referenced_tweets,conversation_id,note_tweet',
    // No expansions: each included post (like the one a mention replies to) is billed as another read,
    // and authors are looked up only for filed bugs ($0.01 each).
  }
  // Search can index a post a few seconds late. Reading only posts at least 30 seconds old means a late one
  // is never passed by since_id before it shows up. X takes ids or times as bounds, not a mix.
  // Search only takes a since_id from the last 7 days. An older one means nothing has matched since, so start 6 days back.
  // With no since_id at all (first run, lost KV, or a new handle), start an hour back instead of filing a week of posts.
  if (sinceId && now - idTime(sinceId) < 6 * DAY) Object.assign(base, { since_id: sinceId, until_id: idAt(now - 30_000) })
  else Object.assign(base, { start_time: new Date(now - (sinceId ? 6 * DAY : 3_600_000)).toISOString(), end_time: new Date(now - 30_000).toISOString() })
  const posts = new Map()
  let newest
  for (const query of queries) {
    const res = await fetchImpl(`${API}/tweets/search/recent?${new URLSearchParams({ ...base, query })}`, {
      headers: { authorization: `Bearer ${bearer}` }
    })
    if (!res.ok) throw new Error(`X search ${res.status}: ${await res.text()}`)
    const body = await res.json()
    for (const t of body.data ?? []) posts.set(t.id, { ...t, text: fullText(t) })
    const id = body.meta?.newest_id
    if (id && (!newest || byIdDesc({ id }, { id: newest }) < 0)) newest = id
  }
  return { data: [...posts.values()].sort(byIdDesc), meta: newest ? { newest_id: newest } : {} }
}

// Posts over 280 characters come back cut in `text`; the whole post is in note_tweet.
export function fullText(t) {
  return t.note_tweet?.text || t.text
}

// Look up name and handle for matched posts only, in one batch ($0.01 per user).
export async function fetchUsers({ ids, bearer, fetchImpl = fetch }) {
  if (!ids.length) return {}
  const params = new URLSearchParams({ ids: [...new Set(ids)].slice(0, 100).join(',') })
  const res = await fetchImpl(`${API}/users?${params}`, { headers: { authorization: `Bearer ${bearer}` } })
  if (!res.ok) throw new Error(`X users ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return Object.fromEntries((body.data ?? []).map(u => [u.id, u]))
}

// OAuth 1.0a user auth for posting replies from the watched X account (X_HANDLE). Unlike OAuth 2 user tokens, these never expire,
// so they can live in Worker secrets. A JSON body isn't part of the signature.
// `extra` adds oauth_callback or oauth_verifier for the PIN flow (scripts/x-connect.mjs), which has no access token yet.
export function oauth1Header({ method, url, apiKey, apiSecret, accessToken, accessSecret = '', extra = {}, nonce = randomBytes(16).toString('hex'), timestamp = String(Math.floor(Date.now() / 1000)) }) {
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  const params = { oauth_consumer_key: apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp, ...(accessToken ? { oauth_token: accessToken } : {}), oauth_version: '1.0', ...extra }
  const u = new URL(url)
  const all = [...Object.entries(params), ...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&')
  params.oauth_signature = createHmac('sha1', `${enc(apiSecret)}&${enc(accessSecret)}`).update(base).digest('base64')
  return 'OAuth ' + Object.entries(params).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')
}

export async function postReply({ text, inReplyTo, auth, fetchImpl = fetch }) {
  const url = `${API}/tweets`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: oauth1Header({ method: 'POST', url, ...auth }), 'content-type': 'application/json' },
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyTo } })
  })
  if (!res.ok) throw new Error(`X reply ${res.status}: ${await res.text()}`)
  return res.json()
}
