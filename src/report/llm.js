// src/report/llm.js — OpenRouter (claude-haiku) call for daily-update drafts. Uses the Forge
// external fetch (egress declared in manifest). Key comes from the encrypted LLM_API_KEY variable.
import { fetch } from '@forge/api';
import daily from './daily-format.js';

export async function draftUpdate(prompt) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY is not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      max_tokens: 260,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return daily.capText(text);
}
