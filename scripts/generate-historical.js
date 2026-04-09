#!/usr/bin/env node
/**
 * generate-historical.js
 * ONE-TIME SCRIPT: Generates weekly summaries for past weeks since the Iran conflict escalated.
 * Run manually once to backfill the archive with historical context.
 *
 * Usage: ANTHROPIC_API_KEY=your_key node scripts/generate-historical.js
 *
 * This generates WEEKLY summaries only (no daily digests for past days).
 * Each week costs roughly 1-3 cents. Total for ~75 weeks: ~$1-2 AUD.
 */

const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable not set.');
  process.exit(1);
}

// War escalation started October 7, 2023
// We'll generate weekly summaries from that point
const WAR_START = new Date('2023-10-02'); // Monday of that week
const NOW = new Date();

function getWeeksFrom(startDate) {
  const weeks = [];
  let current = new Date(startDate);

  while (current < NOW) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Only include completed weeks
    if (weekEnd < NOW) {
      weeks.push({
        week_start: weekStart.toLocaleDateString('en-CA'),
        week_end: weekEnd.toLocaleDateString('en-CA')
      });
    }

    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateWeekSummary(weekStart, weekEnd) {
  const startFormatted = new Date(weekStart).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const endFormatted = new Date(weekEnd).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const prompt = `You are a foreign affairs journalist summarising a specific week of the Iran conflict for an Australian audience.

The week is: ${startFormatted} to ${endFormatted}.

Use your knowledge of what happened during this specific week in the Iran conflict and related Middle East events. Focus on:
- Key military, diplomatic, or nuclear developments
- Regional escalation or de-escalation
- Impact on global energy markets
- Any relevance to Australia

Write a weekly summary with two parts:
1. A short punchy title for the week (max 8 words, e.g. "The week Hormuz tensions peaked")
2. A 3-4 sentence factual summary of the most significant developments that week and their significance

If this week predates significant escalation (before October 2023), focus on nuclear diplomacy and sanctions.
If nothing major happened that week, write a brief note about the ongoing situation at that time.

Return ONLY valid JSON — no markdown, no preamble:
{
  "title": "week title here",
  "summary": "3-4 sentence summary here"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const textBlock = data.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  const cleaned = textBlock.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

async function run() {
  const publicDir = path.join(__dirname, '..', 'public');
  const indexPath = path.join(publicDir, 'archive-index.json');

  let index = { weeks: [] };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  }

  const weeks = getWeeksFrom(WAR_START);
  console.log(`Generating summaries for ${weeks.length} weeks since October 2023...`);
  console.log('Estimated cost: ~$1-3 AUD total\n');

  let processed = 0;
  let skipped = 0;

  for (const week of weeks) {
    // Skip if already exists in index with a summary
    const existing = index.weeks.find(w => w.week_start === week.week_start);
    if (existing && existing.summary) {
      skipped++;
      continue;
    }

    console.log(`Processing ${week.week_start} to ${week.week_end}...`);

    try {
      const result = await generateWeekSummary(week.week_start, week.week_end);

      if (existing) {
        existing.title = result.title;
        existing.summary = result.summary;
      } else {
        index.weeks.push({
          week_start: week.week_start,
          week_end: week.week_end,
          title: result.title,
          summary: result.summary,
          days: []
        });
      }

      console.log(`  ✓ "${result.title}"`);
      processed++;

      // Save after each week in case of interruption
      index.weeks.sort((a, b) => b.week_start.localeCompare(a.week_start));
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

      // Rate limit: wait 1 second between calls
      await sleep(1000);

    } catch (err) {
      console.error(`  ✗ Failed for ${week.week_start}: ${err.message}`);
      await sleep(2000);
    }
  }

  console.log(`\nDone. Processed: ${processed}, Skipped (already existed): ${skipped}`);
  console.log(`Archive index saved to ${indexPath}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
