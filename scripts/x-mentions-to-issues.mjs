// Run the bot once from Node, with since_id in state/since_id.txt. The deployed bot is the Cloudflare Worker.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { run } from './bot.mjs'

export { run, replyText } from './bot.mjs'

const SINCE = new URL('../state/since_id.txt', import.meta.url)

export const fileState = {
  read: () => existsSync(SINCE) ? readFileSync(SINCE, 'utf8').trim() || undefined : undefined,
  write: id => { mkdirSync(new URL('.', SINCE), { recursive: true }); writeFileSync(SINCE, `${id}\n`) },
  note: line => console.log(`note: ${line}`)
}

// A stopped run exits non-zero so a dead AI shows up, after state is saved.
if (process.argv[1] === fileURLToPath(import.meta.url) && (await run({ env: process.env, state: fileState })).stopped) process.exitCode = 1
