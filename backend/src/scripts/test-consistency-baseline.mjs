// Baseline: calls the real DeepSeek endpoint 3x with the EXACT current production request
// shape (no `temperature` param — mirrors aiReviewService.js as it stands right now) to
// quantify how unstable the criteriaCoverage statuses are for the identical input.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from '../prompts/systemPrompt.js'
import { retrieveCoverageMap } from '../services/ragService.js'
import { buildReport } from '../services/reportBuilder.js'

const STUDENT_TEXT = `
Fossil Fuels and Renewable Energy: A Review

Coal, oil and gas are fossil fuels that come from decayed plants and animals buried
underground for millions of years. These fuels are used for generating electricity,
transport, heating and cooking. Burning fossil fuels releases carbon dioxide, methane
and other gases that trap heat in the atmosphere, causing global warming.

Renewable energy sources include solar, wind, hydroelectric, biomass and geothermal
power. Each source has different costs and environmental impacts. Solar and wind have
low running costs but need a lot of land. Hydroelectric power is reliable but dams can
damage river habitats.

Nuclear power uses fission of uranium to generate large amounts of electricity without
direct carbon emissions, but it produces radioactive waste.

In conclusion, renewable energy is better for the environment. Governments should
invest more in solar and wind.
`.trim()

function formatCoverageMap(coverageMap) {
  const lines = ['=== RETRIEVED CRITERIA COVERAGE MAP ===', '']
  for (const criterion of coverageMap) {
    lines.push(`${criterion.criterion_code} (${criterion.level}) — "${criterion.criterion_text}"`)
    for (const match of criterion.matchedChunks) {
      lines.push(`  - "${match.text}"`)
    }
  }
  return lines.join('\n')
}

function buildUserMessage(coverageMapText) {
  return [
    '=== STUDENT ASSIGNMENT TEXT ===',
    STUDENT_TEXT,
    '',
    '=== ASSIGNMENT BRIEF ===',
    '(Not provided — analyze with reduced context accordingly.)',
    '',
    '=== ASSESSMENT RUBRIC ===',
    '(Not provided.)',
    '',
    coverageMapText,
    '',
    'Remember: respond with ONLY the JSON object described in your system instructions — no other text.',
  ].join('\n')
}

function stripCodeFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

const apiKey = process.env.DEEPSEEK_API_KEY
const model = process.env.DEEPSEEK_MODEL || 'claude-sonnet-4-5'
const client = new Anthropic({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL })

const coverageMap = await retrieveCoverageMap(STUDENT_TEXT)
const coverageMapKey = JSON.stringify(coverageMap.map((c) => ({ code: c.criterion_code, n: c.matchedChunks.length })))
const userMessage = buildUserMessage(formatCoverageMap(coverageMap))

console.log('RAG coverage map fingerprint (should be identical if you re-run this script):')
console.log(coverageMapKey)
console.log()

async function runOnce(label, requestOverrides) {
  const response = await client.messages.create({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    ...requestOverrides,
  })
  const textBlock = response.content.find((b) => b.type === 'text')
  const parsed = JSON.parse(stripCodeFences(textBlock.text))
  const { valid, report, reason } = buildReport(parsed)
  if (!valid) {
    console.log(`${label}: INVALID (${reason})`)
    return null
  }
  const statuses = report.criteriaCoverage.map((c) => c.status)
  console.log(`${label}: ${statuses.join(' | ')}`)
  return statuses
}

const N = Number(process.argv[2]) || 3
const label = process.argv[3] || 'BASELINE'
const requestOverrides = process.argv[4] === 'fixed'
  ? { max_tokens: 4096, thinking: { type: 'disabled' }, temperature: 0 }
  : { max_tokens: 4096, thinking: { type: 'disabled' } }

console.log(`Running ${N}x with overrides:`, requestOverrides)
console.log()

const runs = []
for (let i = 1; i <= N; i++) {
  const statuses = await runOnce(`${label} run ${i}`, requestOverrides)
  runs.push(statuses)
}

console.log('\n=== COMPARISON (vs run 1) ===')
const valid = runs.filter(Boolean)
if (valid.length < 2) {
  console.log('Not enough valid runs to compare.')
} else {
  for (let i = 1; i < valid.length; i++) {
    let matches = 0
    for (let j = 0; j < valid[0].length; j++) {
      if (valid[0][j] === valid[i][j]) matches++
    }
    console.log(`Run 1 vs Run ${i + 1}: ${matches}/${valid[0].length} criteria statuses match`)
  }
}
