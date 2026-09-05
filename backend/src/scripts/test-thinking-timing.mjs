// Compares response time and output shape for the OLD config (thinking disabled,
// max_tokens: 4096) vs the NEW config (thinking enabled, max_tokens: 8192) — both real
// calls against the actual DeepSeek Anthropic-compatible endpoint. Also verifies the
// new response's JSON report still validates against buildReport's schema check.

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { getSystemPrompt } from '../prompts/systemPrompt.js'
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
const userMessage = buildUserMessage(formatCoverageMap(coverageMap))

async function runCall(label, requestOverrides) {
  const start = Date.now()
  const response = await client.messages.create({
    model,
    system: getSystemPrompt(),
    messages: [{ role: 'user', content: userMessage }],
    ...requestOverrides,
  })
  const elapsedSeconds = (Date.now() - start) / 1000

  const thinkingBlock = response.content.find((b) => b.type === 'thinking')
  const textBlock = response.content.find((b) => b.type === 'text')

  console.log(`\n=== ${label} ===`)
  console.log(`Response time: ${elapsedSeconds.toFixed(2)}s`)
  console.log(`Content block types: ${response.content.map((b) => b.type).join(', ')}`)
  console.log(`Thinking block present: ${Boolean(thinkingBlock)}${thinkingBlock ? ` (${thinkingBlock.thinking.length} chars)` : ''}`)
  console.log(`stop_reason: ${response.stop_reason}`)
  console.log(`usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`)

  let reportValid = false
  let reportReason = null
  if (textBlock) {
    try {
      const parsed = JSON.parse(stripCodeFences(textBlock.text))
      const { valid, reason } = buildReport(parsed)
      reportValid = valid
      reportReason = reason
    } catch (err) {
      reportReason = 'JSON.parse failed: ' + err.message
    }
  }
  console.log(`Report schema valid: ${reportValid}${reportReason ? ` (${reportReason})` : ''}`)

  return { label, elapsedSeconds, thinkingBlock, reportValid }
}

console.log(`Model in use: ${model}`)
console.log('Calling the real DeepSeek endpoint twice — this may take a while...')

const oldResult = await runCall('OLD (thinking disabled, max_tokens=4096)', {
  max_tokens: 4096,
  thinking: { type: 'disabled' },
})

const newResult = await runCall('NEW (thinking enabled, max_tokens=8192)', {
  max_tokens: 8192,
  thinking: { type: 'enabled', budget_tokens: 4096 },
})

console.log('\n=== SUMMARY ===')
console.log(`Old: ${oldResult.elapsedSeconds.toFixed(2)}s, thinking block: ${Boolean(oldResult.thinkingBlock)}, valid: ${oldResult.reportValid}`)
console.log(`New: ${newResult.elapsedSeconds.toFixed(2)}s, thinking block: ${Boolean(newResult.thinkingBlock)}, valid: ${newResult.reportValid}`)
console.log(`Difference: ${(newResult.elapsedSeconds - oldResult.elapsedSeconds).toFixed(2)}s`)

const failures = [!newResult.thinkingBlock, !newResult.reportValid].filter(Boolean).length
process.exitCode = failures > 0 ? 1 : 0
