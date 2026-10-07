/**
 * OpenRouter chat-completion helper.
 *
 * @module lib/openrouter
 */

const logger = require('./logger');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Send a chat-completion request to OpenRouter.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ apiKey: string, model: string, temperature?: number, maxTokens?: number }} options
 * @returns {Promise<string>} Raw model output.
 */
async function chatCompletion(messages, { apiKey, model, temperature = 0, maxTokens = 1024 }) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://whatsapp-lead-automation.local',
      'X-Title': 'WhatsApp Lead Automation',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = { chatCompletion };
