// Connect the X account the bot watches (@omarchy, or a bot account set as X_HANDLE) for replies, with X's OAuth 1.0a PIN flow.
// Asks for your X app's API key and secret without showing them, prints a link to open while logged in as that account,
// then takes the PIN and saves the reply secrets to the Cloudflare Worker in one step. No secret is printed.
// Run: npm run connect
import { createInterface } from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { oauth1Header } from './x.mjs'

const X = 'https://api.x.com'

export async function requestToken({ apiKey, apiSecret, fetchImpl = fetch }) {
  const url = `${X}/oauth/request_token`
  const res = await fetchImpl(url, { method: 'POST', headers: { authorization: oauth1Header({ method: 'POST', url, apiKey, apiSecret, extra: { oauth_callback: 'oob' } }) } })
  if (!res.ok) throw new Error(`X request_token ${res.status}: ${await res.text()}`)
  return Object.fromEntries(new URLSearchParams(await res.text()))
}

export async function accessToken({ apiKey, apiSecret, token, tokenSecret, pin, fetchImpl = fetch }) {
  const url = `${X}/oauth/access_token`
  const res = await fetchImpl(url, { method: 'POST', headers: { authorization: oauth1Header({ method: 'POST', url, apiKey, apiSecret, accessToken: token, accessSecret: tokenSecret, extra: { oauth_verifier: pin } }) } })
  if (!res.ok) throw new Error(`X access_token ${res.status}: ${await res.text()}`)
  return Object.fromEntries(new URLSearchParams(await res.text()))
}

// Ask without echoing what's typed, for keys: raw mode, so the terminal never prints the characters.
function askHidden(question) {
  const { stdin, stdout } = process
  if (!stdin.isTTY) throw new Error('Run this in a terminal, so keys can be typed without being shown.')
  stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolve, reject) => {
    let answer = ''
    const done = err => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      err ? reject(err) : resolve(answer.trim())
    }
    const onData = chunk => {
      for (const c of chunk.toString('utf8')) {
        if (c === '\r' || c === '\n') return done()
        if (c === '\u0003') return done(new Error('Cancelled'))
        if (c === '\u007f' || c === '\b') answer = answer.slice(0, -1)
        else if (c >= ' ') answer += c
      }
    }
    stdin.on('data', onData)
  })
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const wrangler = (args, opts = {}) => spawnSync('npx', ['wrangler', ...args], { cwd: ROOT, ...opts })

// The X account the Worker watches, from wrangler.toml. Replies only work from that account.
export function watched(toml) {
  const v = name => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]
  return { handle: v('X_HANDLE') || 'omarchy', id: v('X_ACCOUNT_ID') }
}

// All five secrets in one Worker version, so a failure never leaves a mix of old and new credentials.
function putSecrets(secrets) {
  const r = wrangler(['secret', 'bulk'], { input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error('wrangler secret bulk failed')
}

async function main() {
  // Check wrangler before the X steps, so a missing login or Worker doesn't waste the PIN.
  if (wrangler(['deployments', 'status'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('wrangler can\'t see the deployed Worker. Run npx wrangler login, and npm run deploy if it was never deployed.')
  }
  const want = watched(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'))
  console.log('Your X app needs User authentication set up with OAuth 1.0a and Read and write permission.')
  const apiKey = await askHidden('X app API key (consumer key): ')
  const apiSecret = await askHidden('X app API secret (consumer secret): ')
  const req = await requestToken({ apiKey, apiSecret })
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log(`\nLog in to X as @${want.handle} (the account the bot watches), open this link, and click Authorize app:\n\n  ${X}/oauth/authorize?oauth_token=${req.oauth_token}\n`)
  const pin = (await rl.question('PIN shown by X: ')).trim()
  rl.close()
  const acc = await accessToken({ apiKey, apiSecret, token: req.oauth_token, tokenSecret: req.oauth_token_secret, pin })
  console.log(`\nConnected @${acc.screen_name}. Saving the reply secrets to the Worker...`)
  putSecrets({ X_API_KEY: apiKey, X_API_SECRET: apiSecret, X_REPLY_ACCESS_TOKEN: acc.oauth_token, X_REPLY_ACCESS_SECRET: acc.oauth_token_secret, X_REPLY_USER_ID: acc.user_id })
  if (acc.user_id === want.id) {
    console.log(`Done. The bot now replies as @${acc.screen_name} to posts that tag it.`)
  } else {
    console.log(`Saved, but replies stay off: the Worker watches @${want.handle} (${want.id}), not @${acc.screen_name}.`)
    console.log(`To watch @${acc.screen_name} instead, set X_HANDLE = "${acc.screen_name}" and X_ACCOUNT_ID = "${acc.user_id}" in wrangler.toml, then npm run deploy.`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
