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

const SYSTEM_PROMPT = `You are a senior foreign affairs journalist writing for an Australian audience.
Your job is to produce a clear, unbiased, factual daily briefing on the Iran conflict and related regional developments.

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

Please research and write today's Iran conflict briefing for Australians.

Use your web search capability to find the most recent news and developments from the past 24-48 hours. Search for:
- Iran conflict latest news today
- Iran regional tensions today
- Strait of Hormuz oil shipping news
- Iran nuclear deal latest
- Iran Australia relations
- Middle East conflict today Australia

Then synthesise what you find into the structured JSON digest. Prioritise information from the last 24 hours.`;

async function generateDigest() {
  console.log('Generating digest at', new Date().toISOString());

  const requestBody = {
    model: 'claude-opus-4-20250514',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search'
      }
    ],
    messages: [
      {
        role: 'user',
        content: USER_PROMPT
      }
    ]
  };

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    console.error('Network error calling Claude API:', err.message);
    process.exit(1);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', response.status, errorText);
    process.exit(1);
  }

  const data = await response.json();

  // Handle multi-turn: Claude may use web search tool and then respond
  // If stop_reason is tool_use, we need to continue the conversation
  let finalContent = data.content;
  let messages = [{ role: 'user', content: USER_PROMPT }];

  if (data.stop_reason === 'tool_use') {
    // Claude used tools — continue the conversation to get final text
    messages.push({ role: 'assistant', content: data.content });

    // Add tool results (web search handles this internally via API, but we may need to loop)
    // For web_search tool, the API handles retrieval internally and returns results
    // We just need to send back and let it continue
    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    const toolResults = toolUseBlocks.map(block => ({
      type: 'tool_result',
      tool_use_id: block.id,
      content: 'Please use the search results you retrieved to write the digest.'
    }));

    messages.push({ role: 'user', content: toolResults });

    const continueResponse = await fetch('https://api.anthropic.com/v1/messages', {
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

    const continueData = await continueResponse.json();
    finalContent = continueData.content;
  }

  // Extract JSON from text blocks
  const textBlock = finalContent.find(b => b.type === 'text');
  if (!textBlock) {
    console.error('No text block in response. Content:', JSON.stringify(finalContent, null, 2));
    process.exit(1);
  }

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
