// Ask GitHub Models to write a full bug report from an X post. Free with the workflow's GITHUB_TOKEN.
const URL_ = 'https://models.github.ai/inference/chat/completions'

export const PROMPT = `You turn a post on X that tags @omarchy into a GitHub bug report for Omarchy (an Arch Linux + Hyprland setup).
Write only from what the post and its parent say. Never invent versions, hardware, logs, or steps. Write "Not mentioned" when something is missing.
Reply with JSON only: {"title": "...", "body": "..."}.
title: short, specific, plain words, no prefix, under 80 characters.
body: Markdown with exactly these sections:
## What's wrong?
## Steps to reproduce
## Expected vs. actual
## System details
(Omarchy version and hardware, or "Not mentioned")`

/**
 * Draft a title and body with an AI model. Returns null on any failure so the caller can fall back.
 * @param {{text: string, parentText?: string, token: string, model?: string, fetchImpl?: typeof fetch}} opts
 */
export async function draftIssue({ text, parentText, token, model = 'xai/grok-3-mini', fetchImpl = fetch }) {
  if (!token) return null
  const user = parentText ? `Post:\n${text}\n\nIt replies to:\n${parentText}` : `Post:\n${text}`
  try {
    const res = await fetchImpl(URL_, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }] })
    })
    if (!res.ok) { console.error(`AI ${res.status}: ${await res.text()}`); return null }
    const content = (await res.json()).choices?.[0]?.message?.content ?? ''
    const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1))
    return json.title && json.body ? { title: String(json.title).slice(0, 100), body: String(json.body) } : null
  } catch (e) {
    console.error(`AI failed: ${e.message}`)
    return null
  }
}
