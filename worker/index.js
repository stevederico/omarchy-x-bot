// Cloudflare Worker: start the X-mentions workflow on a reliable cron. GitHub's own schedule is best-effort
// and can be hours late or skipped; Cloudflare cron triggers fire on time, and the workflow does the rest.
export async function dispatch(env, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'omarchy-x-bot-trigger'
    },
    body: JSON.stringify({ ref: env.REF })
  })
  if (res.status !== 204) throw new Error(`GitHub dispatch ${res.status}: ${await res.text()}`)
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env))
  }
}
