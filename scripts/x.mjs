// Minimal X API v2 client: read mentions, post a reply.
const API = 'https://api.x.com/2'

export async function fetchMentions({ accountId, sinceId, bearer, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'author_id,created_at,referenced_tweets,conversation_id,note_tweet',
    expansions: 'referenced_tweets.id' // no author_id: user lookups cost $0.01 each
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

export async function postReply({ text, inReplyTo, userToken, fetchImpl = fetch }) {
  const res = await fetchImpl(`${API}/tweets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyTo } })
  })
  if (!res.ok) throw new Error(`X reply ${res.status}: ${await res.text()}`)
  return res.json()
}
