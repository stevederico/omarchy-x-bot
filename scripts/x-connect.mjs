// Connect the bot's own X account (e.g. @omarchybot) for replies, with X's OAuth 1.0a PIN flow.
// Asks for your X app's API key and secret, prints a link to open while logged in as the bot,
// then takes the PIN and saves all four reply secrets to the Cloudflare Worker. Nothing is printed.
// Run: node scripts/x-connect.mjs
import { createInterface } from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
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

// Ask without echoing what's typed, for keys.
async function askHidden(rl, question) {
  const write = rl._writeToOutput
  rl._writeToOutput = s => { if (s.includes(question)) write.call(rl, s) }
  const answer = await rl.question(question)
  rl._writeToOutput = write
  process.stdout.write('\n')
  return answer.trim()
}

function putSecret(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'ignore', 'inherit'] })
  if (r.status !== 0) throw new Error(`wrangler secret put ${name} failed`)
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log('Your X app needs User authentication set up with OAuth 1.0a and Read and write permission.')
  const apiKey = await askHidden(rl, 'X app API key (consumer key): ')
  const apiSecret = await askHidden(rl, 'X app API secret (consumer secret): ')
  const req = await requestToken({ apiKey, apiSecret })
  console.log(`\nLog in to X as the bot account, open this link, and click Authorize app:\n\n  ${X}/oauth/authorize?oauth_token=${req.oauth_token}\n`)
  const pin = (await rl.question('PIN shown by X: ')).trim()
  rl.close()
  const acc = await accessToken({ apiKey, apiSecret, token: req.oauth_token, tokenSecret: req.oauth_token_secret, pin })
  console.log(`\nConnected @${acc.screen_name}. Saving the reply secrets to the Worker...`)
  putSecret('X_API_KEY', apiKey)
  putSecret('X_API_SECRET', apiSecret)
  putSecret('X_REPLY_ACCESS_TOKEN', acc.oauth_token)
  putSecret('X_REPLY_ACCESS_SECRET', acc.oauth_token_secret)
  console.log(`Done. The bot now replies as @${acc.screen_name}.`)
}

if (import.meta.main) await main()
