import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchMentions } from '../scripts/x.mjs'

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
  const res = await fetchMentions({ accountId: '0', bearer: 'b', fetchImpl })
  assert.match(new URL(url).searchParams.get('tweet.fields'), /note_tweet/)
  assert.deepEqual(res.data.map(t => t.text), [long, 'short'])
  assert.equal(res.includes.tweets[0].text, 'whole parent')
})
