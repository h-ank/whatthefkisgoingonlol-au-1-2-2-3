#!/usr/bin/env node

/**
 * generate-digest.js
 * Calls the Claude API with web search to generate a fresh Iran conflict digest.
 * Writes the result to public/digest.json
 * Run by GitHub Actions daily at 6AM AEDT (7PM UTC previous day).
 */

const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable not set.');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are a senior foreign affairs journalist writing for an Australian audience. Your job is to produce a clear, unbiased, factual daily briefing on the Iran conflict and related regional developments.

RULES:
- Be strictly factual. Do not editoralise, speculate, or take sides.
- Label anything that is not confirmed fact (e.g. "analysts suggest", "reportedly", "unverified claims").
- Write in plain English. Assume readers are intelligent but not experts.
- Always include an Australian angle — Australia's alliances, energy market exposure, government positions, diaspora impacts.
- Draw from multiple reputable sources: Reuters, AP, BBC, Al Jazeera English, The Guardian, ABC Australia.
- Do not repeat yesterday's news as if it is new. Focus on what has actually changed or developed.
- Be proportionate — do not amplify or minimise events based on which party they benefit.

OUTPUT FORMAT:
You must return ONLY valid JSON — no markdown, no code fences, no preamble. Just the raw JSON object.
The JSON must match this exact schema:
{
  "generated_at": "<ISO 8601 datetime string in Australian Eastern time>",
  "sources": ["source1", "source2", ...],
  "sections": [
    {
      "label": "Section category (short, 1-3 words)",
      "title": "Descriptive headline for this section",
      "paragraphs": ["paragraph text", "paragraph text", ...],
      "key_facts": ["short fact", "short fact", ...],
      "australia_relevance": "One paragraph on why this matters for Australia specifically, or null if not applicable"
    }
  ]
}

REQUIRED SECTIONS (in this order):
1. label: "Situation Overview" — What is happening right now, today. New developments only.
2. label: "Background" — Essential context for readers who haven't been following closely. Who are the key parties, what are the core disputes, what has led to this point.
3. label: "Diplomacy" — Diplomatic activity, statements, negotiations, sanctions, international responses. Include Australia's government position if relevant.
4. label: "Economy & Energy" — Oil and gas market impacts, sanctions effects, supply chain issues. Always include impact on Australian fuel/energy prices.
5. label: "What to Watch" — Key upcoming events, deadlines, or flashpoints. Grounded in facts, not speculation.

Each section should have 2-4 paragraphs, 3-6 key_facts bullet points, and an australia_relevance string where applicable.
Keep paragraphs to 3-5 sentences. Clear, direct prose. No bullet points in paragraph text.`;

const USER_PROMPT = `Today is ${new Date().toLocaleDateString('en-AU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney'
})}.

Please research and write today's Iran conflict briefing for Australians. Use your web search capability to find the most recent news and developments from the past 24-48 hours. Search for:
- Iran conflict latest news today
- Iran regional tensions today
- Strait of Hormuz oil shipping news
- Iran nuclear deal latest
- Iran Australia relations
- Middle East conflict today Australia

Then synthesise what you find into the structured JSON digest. Prioritise information from the last 24 hours.

IMPORTANT: Your final response must be ONLY the raw JSON object. No explanation, no markdown, no preamble before or after the JSON.`;

async function callClaude(messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', response.status, errorText);
    process.exit(1);
  }

  return response.json();
}

async function generateDigest() {
  console.log('Generating digest at', new Date().toISOString());

  let messages = [{ role: 'user', content: USER_PROMPT }];
  let finalContent = null;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  // Loop until Claude finishes (handles multiple web search tool calls)
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`API call iteration ${iterations}...`);

    const data = await callClaude(messages);
    console.log(`stop_reason: ${data.stop_reason}, content blocks: ${data.content.length}`);

    if (data.stop_reason === 'end_turn') {
      finalContent = data.content;
      break;
    }

    if (data.stop_reason === 'tool_use') {
      // Add assistant message with tool_use blocks
      messages.push({ role: 'assistant', content: data.content });

      // For web_search_20250305, send back empty tool results
      // Anthropic's API fills in actual search results server-side
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: ''
        }));

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — use whatever we have
    console.warn(`Unexpected stop_reason: ${data.stop_reason}`);
    finalContent = data.content;
    break;
  }

  if (!finalContent) {
    console.error('No final content after', iterations, 'iterations');
    process.exit(1);
  }

  // Find the LAST text block (earlier blocks may be conversational preamble)
  const textBlocks = finalContent.filter(b => b.type === 'text');
  const textBlock = textBlocks[textBlocks.length - 1];

  if (!textBlock) {
    console.error('No text block in final response. Content:', JSON.stringify(finalContent, null, 2));
    process.exit(1);
  }

  console.log('Raw text (first 200 chars):', textBlock.text.substring(0, 200));

  let digestJson;
  try {
    // Strip any accidental markdown code fences
    const cleaned = textBlock.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    digestJson = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse JSON from Claude response:', err.message);
    console.error('Raw text:', textBlock.text);
    process.exit(1);
  }

  // Ensure generated_at is set
  if (!digestJson.generated_at) {
    digestJson.generated_at = new Date().toISOString();
  }

  const outputPath = path.join(__dirname, '..', 'public', 'digest.json');
  fs.writeFileSync(outputPath, JSON.stringify(digestJson, null, 2));
  console.log('Digest written to', outputPath);
  console.log('Sections generated:', digestJson.sections?.length ?? 0);
  console.log('Done.');
}

generateDigest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
