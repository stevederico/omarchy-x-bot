import test from 'node:test'
import assert from 'node:assert/strict'
import { draftIssue } from '../scripts/ai.mjs'

const reply = content => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })

test('parses the JSON the model returns, even inside a code fence', async () => {
  const d = await draftIssue({ text: 'x', token: 't', fetchImpl: reply('```json\n{"title":"T","body":"B"}\n```') })
  assert.deepEqual(d, { title: 'T', body: 'B' })
})

test('returns null on bad output or no token, so the plain issue is used', async () => {
  assert.equal(await draftIssue({ text: 'x', token: 't', fetchImpl: reply('nope') }), null)
  assert.equal(await draftIssue({ text: 'x', token: '' }), null)
})

test('a post that is not a bug is flagged so it gets skipped', async () => {
  assert.deepEqual(await draftIssue({ text: 'x', token: 't', fetchImpl: reply('{"bug":false}') }), { bug: false })
})
