// Minimal X API v2 client: read mentions, post a reply.
const API = 'https://api.x.com/2'

export async function fetchMentions({ accountId, sinceId, bearer, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'author_id,created_at,referenced_tweets,conversation_id',
    expansions: 'author_id,referenced_tweets.id',
    'user.fields': 'username'
  })
  if (sinceId) params.set('since_id', sinceId)
  const res = await fetchImpl(`${API}/users/${accountId}/mentions?${params}`, {
    headers: { authorization: `Bearer ${bearer}` }
  })
  if (!res.ok) throw new Error(`X mentions ${res.status}: ${await res.text()}`)
  return res.json()
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
