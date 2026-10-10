// Minimal X API v2 client: read mentions, post a reply.
import { createHmac, randomBytes } from 'node:crypto'

const API = 'https://api.x.com/2'

export async function fetchMentions({ accountId, sinceId, bearer, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'author_id,created_at,referenced_tweets,conversation_id,note_tweet'
    // No expansions: each included post (like the one a mention replies to) is billed as another read,
    // which doubled the cost, and authors are looked up only for filed bugs ($0.01 each).
  })
  if (sinceId) params.set('since_id', sinceId)
  const res = await fetchImpl(`${API}/users/${accountId}/mentions?${params}`, {
    headers: { authorization: `Bearer ${bearer}` }
  })
  if (!res.ok) throw new Error(`X mentions ${res.status}: ${await res.text()}`)
  const body = await res.json()
  for (const t of [...(body.data ?? []), ...(body.includes?.tweets ?? [])]) t.text = fullText(t)
  return body
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

// OAuth 1.0a user auth for posting replies from the bot's own X account (not @omarchy). Unlike OAuth 2 user tokens, these never expire,
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
