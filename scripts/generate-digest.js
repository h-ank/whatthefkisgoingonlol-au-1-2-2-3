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
- Always include an Australian angle where relevant.
- Draw from multiple reputable sources: Reuters, AP, BBC, Al Jazeera English, The Guardian, ABC Australia.
- Do not repeat yesterday's news as if it is new. Focus on what has actually changed or developed.
- Be proportionate — do not amplify or minimise events based on which party they benefit.
- Do NOT include any HTML tags like <cite>, <a>, or any other markup in your output. Plain text only.
- Keep each section concise: 2 paragraphs max, 4 key_facts max. Be brief.

OUTPUT FORMAT:
You must return ONLY valid JSON — no markdown, no code fences, no preamble. Just the raw JSON object.
The JSON must match this exact schema:
{
  "generated_at": "<ISO 8601 datetime string in Australian Eastern time>",
  "sources": ["source1", "source2"],
  "sections": [
    {
      "label": "Section category (short, 1-3 words)",
      "title": "Descriptive headline for this section",
      "paragraphs": ["paragraph text", "paragraph text"],
      "key_facts": ["short fact", "short fact"],
      "australia_relevance": "One paragraph or null"
    }
  ]
}

REQUIRED SECTIONS (in this order):
1. label: "Situation Overview" — What is happening right now, today. New developments only.
2. label: "Background" — Essential context. Key parties, core disputes, what led to this.
3. label: "Diplomacy" — Diplomatic activity, statements, sanctions, international responses.
4. label: "Economy & Energy" — Oil/gas impacts, sanctions, supply chain. Include Australian fuel/energy impact.
5. label: "What to Watch" — Key upcoming events or flashpoints. Facts only, no speculation.

Keep each section to 2 paragraphs of 3-4 sentences. 4 key_facts max per section. Be concise.`;

const USER_PROMPT = `Today is ${new Date().toLocaleDateString('en-AU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney'
})}.

Please research and write today's Iran conflict briefing for Australians. Use web search to find recent news from the past 24-48 hours. Search for:
- Iran conflict latest news today
- Iran regional tensions today
- Strait of Hormuz shipping news
- Iran nuclear deal latest
- Iran Australia relations

Synthesise what you find into the structured JSON digest. Prioritise the last 24 hours.

CRITICAL: Return ONLY the raw JSON object. No explanation, no markdown, no HTML tags like <cite> anywhere in the output.`;

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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
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
      messages.push({ role: 'assistant', content: data.content });
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

    console.warn(`Unexpected stop_reason: ${data.stop_reason}`);
    finalContent = data.content;
    break;
  }

  if (!finalContent) {
    console.error('No final content after', iterations, 'iterations');
    process.exit(1);
  }

  const textBlocks = finalContent.filter(b => b.type === 'text');
  const textBlock = textBlocks[textBlocks.length - 1];

  if (!textBlock) {
    console.error('No text block in final response. Content:', JSON.stringify(finalContent, null, 2));
    process.exit(1);
  }

  console.log('Raw text (first 200 chars):', textBlock.text.substring(0, 200));

  let digestJson;
  try {
    const cleaned = textBlock.text
      .replace(/<cite[^>]*>/gi, '')
      .replace(/<\/cite>/gi, '')
      .replace(/^[\s\S]*?(?=\{)/, '')  // strip any preamble before first {
      .replace(/^[\s\S]*?(?=\[)/, '')  // or before first [
      .replace(/^\x60\x60\x60json\s*/i, '')
      .replace(/^\x60\x60\x60\s*/i, '')
      .replace(/\x60\x60\x60\s*$/i, '')
      .trim();
    digestJson = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse JSON from Claude response:', err.message);
    console.error('Raw text:', textBlock.text.substring(0, 500));
    process.exit(1);
  }

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
