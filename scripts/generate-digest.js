#!/usr/bin/env node
/**
 * generate-digest.js
 * Calls the Claude API with web search to generate a fresh Iran conflict digest.
 * Saves to public/digest.json (current) and public/digests/YYYY-MM-DD.json (archive).
 * Updates public/archive-index.json.
 * Run by GitHub Actions daily at 6AM AEDT.
 */

const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NETLIFY_DEPLOY_HOOK = process.env.NETLIFY_DEPLOY_HOOK;

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable not set.');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are a senior foreign affairs journalist writing for an Australian audience. Your job is to produce a clear, unbiased, factual daily briefing on the Iran conflict and related regional developments.

RULES:
- Be strictly factual. Do not editorialise, speculate, or take sides.
- Label anything unconfirmed (e.g. "analysts suggest", "reportedly").
- Write in plain English. Intelligent readers, not experts.
- Always include an Australian angle where relevant.
- Sources: Reuters, AP, BBC, Al Jazeera English, The Guardian, ABC Australia.
- Focus on what has changed in the last 24 hours.
- No HTML tags of any kind in your output. Plain text only.

OUTPUT FORMAT:
Return ONLY a valid JSON object — no markdown, no code fences, no preamble.

Schema:
{
  "generated_at": "<ISO 8601 datetime in Australian Eastern time>",
  "headline": "<One sentence summary of today's most important development>",
  "sources": ["source1", "source2"],
  "sections": [
    {
      "label": "Short category (1-3 words)",
      "title": "Section headline",
      "paragraphs": ["paragraph 1", "paragraph 2"],
      "key_facts": ["fact 1", "fact 2", "fact 3"],
      "australia_relevance": "One sentence on Australian relevance, or null"
    }
  ]
}

REQUIRED SECTIONS (in order):
1. "Situation Overview" — New developments in the last 24 hours only.
2. "Background" — Essential context: key parties, core disputes.
3. "Diplomacy" — Statements, sanctions, international responses.
4. "Economy & Energy" — Oil/gas impacts, Australian fuel/energy prices.
5. "What to Watch" — Upcoming flashpoints, grounded in facts.

Keep each section to 2 short paragraphs (3-4 sentences each). Max 4 key_facts per section. Be concise.`;

const USER_PROMPT = `Today is ${new Date().toLocaleDateString('en-AU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney'
})}.

Search for the latest Iran conflict news from the past 24-48 hours and write today's briefing for Australians.

CRITICAL: Return ONLY the raw JSON object. No explanation, no markdown, no HTML.`;

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
      max_tokens: 2000,
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
  const MAX_ITERATIONS = 3;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`API call iteration ${iterations}...`);

    const data = await callClaude(messages);
    console.log(`stop_reason: ${data.stop_reason}`);

    if (data.stop_reason === 'end_turn') {
      finalContent = data.content;
      break;
    }

    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

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
    console.error('No text block in final response.');
    process.exit(1);
  }

  let digestJson;
  try {
    const cleaned = textBlock.text
      .replace(/<[^>]+>/g, '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    digestJson = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse JSON:', err.message);
    console.error('Raw text:', textBlock.text.substring(0, 500));
    process.exit(1);
  }

  if (!digestJson.generated_at) {
    digestJson.generated_at = new Date().toISOString();
  }

  const publicDir = path.join(__dirname, '..', 'public');
  const digestsDir = path.join(publicDir, 'digests');

  if (!fs.existsSync(digestsDir)) {
    fs.mkdirSync(digestsDir, { recursive: true });
  }

  // Save current digest
  const currentPath = path.join(publicDir, 'digest.json');
  fs.writeFileSync(currentPath, JSON.stringify(digestJson, null, 2));
  console.log('Current digest written.');

  // Save dated archive copy
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
  const archivedPath = path.join(digestsDir, `${dateStr}.json`);
  fs.writeFileSync(archivedPath, JSON.stringify(digestJson, null, 2));
  console.log(`Archive digest saved: ${dateStr}.json`);

  // Update archive index
  updateArchiveIndex(publicDir, digestsDir, dateStr, digestJson);

  // Trigger Netlify deploy
  if (NETLIFY_DEPLOY_HOOK) {
    console.log('Triggering Netlify deploy...');
    const deployRes = await fetch(NETLIFY_DEPLOY_HOOK, { method: 'POST' });
    console.log('Netlify deploy triggered:', deployRes.status);
  }

  console.log('Done.');
}

function updateArchiveIndex(publicDir, digestsDir, todayStr, digestJson) {
  const indexPath = path.join(publicDir, 'archive-index.json');

  let index = { weeks: [] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing archive index, starting fresh.');
    }
  }

  // Find or create the week for today
  const today = new Date(todayStr);
  const dayOfWeek = today.getDay(); // 0=Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysFromMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weekStartStr = weekStart.toLocaleDateString('en-CA');
  const weekEndStr = weekEnd.toLocaleDateString('en-CA');

  let week = index.weeks.find(w => w.week_start === weekStartStr);
  if (!week) {
    week = {
      week_start: weekStartStr,
      week_end: weekEndStr,
      title: null,
      summary: null,
      days: []
    };
    index.weeks.unshift(week);
  }

  // Add or update today's entry
  const existingDay = week.days.find(d => d.date === todayStr);
  const dayEntry = {
    date: todayStr,
    headline: digestJson.headline || digestJson.sections?.[0]?.title || 'Daily briefing',
    file: `digests/${todayStr}.json`
  };

  if (existingDay) {
    Object.assign(existingDay, dayEntry);
  } else {
    week.days.push(dayEntry);
    week.days.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Sort weeks newest first
  index.weeks.sort((a, b) => b.week_start.localeCompare(a.week_start));

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log('Archive index updated.');
}

generateDigest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
