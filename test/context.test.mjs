import test from 'node:test'
import assert from 'node:assert/strict'
import { repoContext, withBodies } from '../scripts/context.mjs'

const json = body => ({ ok: true, json: async () => body })
const b64 = s => Buffer.from(s).toString('base64')

test('repo context has AGENTS.md, paths matching the keywords, and the matching manual page', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/contents/AGENTS.md')) return json({ content: b64('# Agents') })
    if (url.includes('/git/trees/')) return json({ tree: ['bin/omarchy-toggle-idle', 'manual/13-toggles-idle-screensaver.md', 'bin/omarchy-theme-set', 'shell'].map(path => ({ path, type: path === 'shell' ? 'tree' : 'blob' })) })
    if (url.endsWith('/contents/manual/13-toggles-idle-screensaver.md')) return json({ content: b64('Idle manual') })
    throw new Error(url)
  }
  const ctx = await repoContext({ terms: 'idle inhibit', token: 't', fetchImpl })
  assert.equal(ctx, 'AGENTS.md:\n# Agents\n\nFiles matching idle, inhibit:\nbin/omarchy-toggle-idle\nmanual/13-toggles-idle-screensaver.md\n\nmanual/13-toggles-idle-screensaver.md:\nIdle manual')
})

test('context and bodies are best effort', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 })
  assert.equal(await repoContext({ terms: 'idle', token: 't', fetchImpl }), '')
  assert.deepEqual(await withBodies({ related: [{ number: 1, title: 't' }], token: 't', fetchImpl }), [{ number: 1, title: 't' }])
})
