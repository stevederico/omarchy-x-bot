// Ask GitHub Models to write a bug report in Omarchy's bug.yml shape from an X post. Free with the workflow's GITHUB_TOKEN.
const URL_ = 'https://models.github.ai/inference/chat/completions'

export const PROMPT = `You turn a post on X that tags @omarchy into a GitHub issue for Omarchy (an Arch Linux + Hyprland setup), following its bug template.
Omarchy issues are for validated bugs only. Support questions, feature ideas, praise, and jokes are not bugs.
Write only from what the post and its parent say. Never invent versions, hardware, logs, or steps.
Reply with JSON only: {"bug": true|false, "title": "...", "system_details": "...", "whats_wrong": "..."}.
bug: false unless the post describes something in Omarchy that doesn't work.
title: short, specific, plain words, under 80 characters.
system_details: CPU, GPU, and Omarchy version as the post states them, e.g. "AMD 9950X, NVIDIA 5090, Omarchy 2.1.0", or "Not mentioned".
whats_wrong: Markdown. What's broken, steps to recreate it if the post gives them, and what the reporter expected. End with: "Please run \`omarchy-debug\` and attach the output."`

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
    if (json.bug === false) return { bug: false }
    if (!json.title || !json.whats_wrong) return null
    const body = `### System details\n\n${json.system_details || 'Not mentioned'}\n\n### What's wrong?\n\n${json.whats_wrong}`
    return { bug: true, title: String(json.title).slice(0, 100), body }
  } catch (e) {
    console.error(`AI failed: ${e.message}`)
    return null
  }
}
