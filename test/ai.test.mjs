import test from 'node:test'
import assert from 'node:assert/strict'
import { draftIssue } from '../scripts/ai.mjs'

const reply = content => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })

test('fills in the bug template from the model JSON, even inside a code fence', async () => {
  const d = await draftIssue({ text: 'x', token: 't', fetchImpl: reply('```json\n{"bug":true,"title":"T","system_details":"","whats_wrong":"W"}\n```') })
  assert.equal(d.title, 'T')
  assert.equal(d.body, "### System details\n\nNot mentioned\n\n### What's wrong?\n\nW")
})

test('returns null on bad output or no token, so the plain issue is used', async () => {
  assert.equal(await draftIssue({ text: 'x', token: 't', fetchImpl: reply('nope') }), null)
  assert.equal(await draftIssue({ text: 'x', token: '' }), null)
})

test('a post that is not a bug is flagged so it gets skipped', async () => {
  assert.deepEqual(await draftIssue({ text: 'x', token: 't', fetchImpl: reply('{"bug":false}') }), { bug: false })
})
