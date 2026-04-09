#!/usr/bin/env node
/**
 * generate-weekly.js
 * Reads the past 7 daily digests and generates a weekly summary.
 * Adds the summary to archive-index.json.
 * Run by GitHub Actions every Sunday.
 */

const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NETLIFY_DEPLOY_HOOK = process.env.NETLIFY_DEPLOY_HOOK;

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable not set.');
  process.exit(1);
}

async function generateWeeklySummary() {
  const publicDir = path.join(__dirname, '..', 'public');
  const digestsDir = path.join(publicDir, 'digests');
  const indexPath = path.join(publicDir, 'archive-index.json');

  if (!fs.existsSync(indexPath)) {
    console.log('No archive index found, nothing to summarise.');
    return;
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!index.weeks || !index.weeks.length) {
    console.log('No weeks in archive index.');
    return;
  }

  // Find the most recent completed week that has no summary yet
  const today = new Date();
  const weekToSummarise = index.weeks.find(week => {
    const weekEnd = new Date(week.week_end);
    return weekEnd < today && !week.summary && week.days && week.days.length > 0;
  });

  if (!weekToSummarise) {
    console.log('No unsummarised completed weeks found.');
    return;
  }

  console.log(`Summarising week of ${weekToSummarise.week_start}...`);

  // Load daily digests for this week
  const dailyContents = [];
  weekToSummarise.days.forEach(day => {
    const filePath = path.join(publicDir, day.file);
    if (fs.existsSync(filePath)) {
      try {
        const digest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        dailyContents.push({
          date: day.date,
          headline: day.headline,
          sections: digest.sections
        });
      } catch (e) {
        console.warn(`Could not read ${filePath}`);
      }
    }
  });

  if (!dailyContents.length) {
    console.log('No daily digests found for this week.');
    return;
  }

  const digestSummary = dailyContents.map(d =>
    `${d.date}: ${d.headline}\n` +
    d.sections.map(s => `  ${s.label}: ${s.title}`).join('\n')
  ).join('\n\n');

  const prompt = `You are summarising a week of news about the Iran conflict for an Australian audience.

Here are the daily headlines and section titles from the week of ${weekToSummarise.week_start} to ${weekToSummarise.week_end}:

${digestSummary}

Write a weekly summary with two parts:
1. A short punchy title for the week (e.g. "The week tensions peaked", "A fragile pause") — max 8 words
2. A 3-4 sentence summary paragraph of the week's most significant developments and what they mean for Australia

Return ONLY valid JSON:
{
  "title": "week title here",
  "summary": "summary paragraph here"
}

No markdown, no preamble, just the JSON object.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('API error:', err);
    process.exit(1);
  }

  const data = await response.json();
  const textBlock = data.content.find(b => b.type === 'text');

  if (!textBlock) {
    console.error('No text in response');
    process.exit(1);
  }

  let result;
  try {
    const cleaned = textBlock.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    result = JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse weekly summary JSON:', e.message);
    process.exit(1);
  }

  // Update the week in the index
  weekToSummarise.title = result.title;
  weekToSummarise.summary = result.summary;

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Weekly summary added: "${result.title}"`);

  if (NETLIFY_DEPLOY_HOOK) {
    const deployRes = await fetch(NETLIFY_DEPLOY_HOOK, { method: 'POST' });
    console.log('Netlify deploy triggered:', deployRes.status);
  }

  console.log('Done.');
}

generateWeeklySummary().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
