import test from 'node:test'
import assert from 'node:assert/strict'
import { searchMentions, oauth1Header, idTime } from '../scripts/x.mjs'
import { mentionQuery } from '../scripts/issue.mjs'

test('long posts and their parents come back whole, not cut at 280 characters', async () => {
  const long = `bug: ${'a'.repeat(400)}`
  let url
  const fetchImpl = async u => {
    url = u
    return { ok: true, json: async () => ({
      data: [{ id: '2', text: `${long.slice(0, 275)}…`, note_tweet: { text: long } }, { id: '3', text: 'short' }],
      includes: { tweets: [{ id: '1', text: 'cut…', note_tweet: { text: 'whole parent' } }] }
    }) }
  }
  const res = await searchMentions({ query: 'q', bearer: 'b', fetchImpl })
  assert.match(new URL(url).searchParams.get('tweet.fields'), /note_tweet/)
  assert.deepEqual(res.data.map(t => t.text), [long, 'short'])
  assert.equal(res.includes.tweets[0].text, 'whole parent')
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
  let url
  await searchMentions({ query: mentionQuery('omarchy'), sinceId: '1976000000000000000', bearer: 'b', now: idTime('1976000000000000000') + 60_000, fetchImpl: async u => { url = u; return { ok: true, json: async () => ({}) } } })
  const params = new URL(url).searchParams
  assert.match(url, /\/2\/tweets\/search\/recent\?/)
  assert.equal(params.get('query'), `@omarchy (bug OR bugs OR buggy OR broken OR fix OR fixed OR fixes OR fixing OR issue OR issues OR crash OR crashes OR crashed OR crashing OR error OR errors OR errored OR bugged OR "not working" OR "doesn't work" OR "doesnt work" OR "doesn’t work") -from:omarchy -is:retweet`)
  assert.equal(params.get('since_id'), '1976000000000000000')
  assert.equal(params.has('expansions'), false)
})

test('a since_id older than search allows becomes a 6-day start_time, since nothing has matched since', async () => {
  let url
  const now = idTime('1976000000000000000') + 8 * 86_400_000
  await searchMentions({ query: 'q', sinceId: '1976000000000000000', bearer: 'b', now, fetchImpl: async u => { url = u; return { ok: true, json: async () => ({}) } } })
  const params = new URL(url).searchParams
  assert.equal(params.has('since_id'), false)
  assert.equal(params.get('start_time'), new Date(now - 6 * 86_400_000).toISOString())
})
