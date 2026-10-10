import test from 'node:test'
import assert from 'node:assert/strict'
import { searchMentions, oauth1Header, idTime } from '../scripts/x.mjs'
import { mentionQueries } from '../scripts/issue.mjs'

test('long posts and their parents come back whole, not cut at 280 characters', async () => {
  const long = `bug: ${'a'.repeat(400)}`
  let url
  const fetchImpl = async u => {
    url = u
    return { ok: true, json: async () => ({
      data: [{ id: '3', text: 'short' }, { id: '2', text: `${long.slice(0, 275)}…`, note_tweet: { text: long } }]
    }) }
  }
  const res = await searchMentions({ queries: ['q'], bearer: 'b', fetchImpl })
  assert.match(new URL(url).searchParams.get('tweet.fields'), /note_tweet/)
  assert.deepEqual(res.data.map(t => t.text), ['short', long])
})

// X's own worked example: https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
test('OAuth 1.0a signature matches the published example', () => {
  const header = oauth1Header({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958'
  })
  // Same inputs minus the form body (ours is JSON, which isn't signed); cross-checked with a separate implementation
  // that reproduces the docs' hCtSmYh+iHYCEqBWrE7C7hYmtUk= when the body is included.
  assert.equal(decodeURIComponent(header.match(/oauth_signature="(.+?)"/)[1]), 'swB2/K4QtoSNF7fQfLzyNivuoj4=')
})

test('the PIN flow asks for an oob request token, then trades the PIN for the bot account tokens', async () => {
  const { requestToken, accessToken } = await import('../scripts/x-connect.mjs')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization })
    const body = url.endsWith('/request_token') ? 'oauth_token=rt&oauth_token_secret=rts&oauth_callback_confirmed=true' : 'oauth_token=at&oauth_token_secret=ats&user_id=9&screen_name=omarchybot'
    return { ok: true, text: async () => body }
  }
  const req = await requestToken({ apiKey: 'k', apiSecret: 's', fetchImpl })
  assert.equal(req.oauth_token, 'rt')
  assert.match(calls[0].auth, /oauth_callback="oob"/)
  assert.doesNotMatch(calls[0].auth, /oauth_token=/)
  const acc = await accessToken({ apiKey: 'k', apiSecret: 's', token: 'rt', tokenSecret: 'rts', pin: '1234567', fetchImpl })
  assert.deepEqual([acc.oauth_token, acc.oauth_token_secret, acc.screen_name], ['at', 'ats', 'omarchybot'])
  assert.match(calls[1].auth, /oauth_token="rt".*oauth_verifier="1234567"/)
})

test('mentions are searched with the keywords and without expansions, so X bills only matching posts', async () => {
  const urls = []
  const now = idTime('1976000000000000000') + 60_000
  await searchMentions({ queries: mentionQueries('omarchy'), sinceId: '1976000000000000000', bearer: 'b', now, fetchImpl: async u => { urls.push(u); return { ok: true, json: async () => ({}) } } })
  assert.equal(urls.length, mentionQueries('omarchy').length)
  for (const url of urls) {
    const params = new URL(url).searchParams
    assert.match(url, /\/2\/tweets\/search\/recent\?/)
    assert.match(params.get('query'), /^@omarchy \(.+\) -from:omarchy -is:retweet$/)
    assert.ok(params.get('query').length <= 512, 'X caps search queries at 512 characters')
    assert.equal(params.get('since_id'), '1976000000000000000')
    assert.equal(idTime(params.get('until_id')), now - 30_000, 'posts under 30 seconds old wait for the next run')
    assert.equal(params.has('end_time') || params.has('start_time'), false, "X rejects ids mixed with times")
    assert.equal(params.has('expansions'), false)
  }
})

test('several searches merge into one newest-first list, each post once, with the newest id across all', async () => {
  const pages = [
    { data: [{ id: '10', text: 'a' }, { id: '8', text: 'b' }], meta: { newest_id: '10' } },
    { data: [{ id: '11', text: 'c' }, { id: '8', text: 'b' }], meta: { newest_id: '11' } }
  ]
  const res = await searchMentions({ queries: ['q1', 'q2'], bearer: 'b', fetchImpl: async () => ({ ok: true, json: async () => pages.shift() }) })
  assert.deepEqual(res.data.map(t => t.id), ['11', '10', '8'])
  assert.equal(res.meta.newest_id, '11')
})

test('a since_id older than search allows becomes a 6-day start_time, since nothing has matched since', async () => {
  let url
  const now = idTime('1976000000000000000') + 8 * 86_400_000
  await searchMentions({ queries: ['q'], sinceId: '1976000000000000000', bearer: 'b', now, fetchImpl: async u => { url = u; return { ok: true, json: async () => ({}) } } })
  const params = new URL(url).searchParams
  assert.equal(params.has('since_id'), false)
  assert.equal(params.get('start_time'), new Date(now - 6 * 86_400_000).toISOString())
  assert.equal(params.get('end_time'), new Date(now - 30_000).toISOString())
  assert.equal(params.has('until_id'), false)
})

test('with no since_id, search starts an hour back instead of filing a week of posts', async () => {
  let url
  const now = Date.UTC(2026, 9, 9)
  await searchMentions({ queries: ['q'], bearer: 'b', now, fetchImpl: async u => { url = u; return { ok: true, json: async () => ({}) } } })
  assert.equal(new URL(url).searchParams.get('start_time'), new Date(now - 3_600_000).toISOString())
})

test('connect reads the watched account from wrangler.toml', async () => {
  const { watched } = await import('../scripts/x-connect.mjs')
  assert.deepEqual(watched('[vars]\nX_HANDLE = "omarchybot"       # tag\nX_ACCOUNT_ID = "42" # id\n'), { handle: 'omarchybot', id: '42' })
  assert.deepEqual(watched('X_ACCOUNT_ID = "7"'), { handle: 'omarchy', id: '7' })
})
