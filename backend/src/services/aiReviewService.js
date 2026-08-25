import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from '../prompts/systemPrompt.js'
import { retrieveCoverageMap } from './ragService.js'

function formatCoverageMap(coverageMap) {
  const lines = [
    '=== RETRIEVED CRITERIA COVERAGE MAP (via semantic retrieval, RAG) ===',
    "This section shows which parts of the student's text were automatically matched",
    'to each official rubric criterion via semantic similarity search against a',
    'knowledge base built from the official rubric AND the detailed assignment brief',
    '(task requirements, content topics, evidence checklists). Use this as grounded',
    'evidence when assessing "Assessment Criteria Coverage", in addition to your own',
    'reading of the full text.',
    '',
  ]

  for (const criterion of coverageMap) {
    lines.push(`${criterion.criterion_code} (${criterion.level}) — "${criterion.criterion_text}"`)
    if (criterion.matchedChunks.length === 0) {
      lines.push('  No matching passages found above the similarity threshold — this may indicate')
      lines.push('  the criterion is not covered, but verify by reading the full text.')
    } else {
      lines.push('  Matched passages:')
      for (const match of criterion.matchedChunks) {
        lines.push(
          `  - (similarity ${match.similarity.toFixed(2)}, matched topic: "${match.matchedTopic}") "${match.text}"`,
        )
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildUserMessage({ studentText, briefText, rubricText, coverageMapText }) {
  return [
    '=== STUDENT ASSIGNMENT TEXT ===',
    studentText,
    '',
    '=== ASSIGNMENT BRIEF ===',
    briefText || '(Not provided — analyze with reduced context accordingly.)',
    '',
    '=== ASSESSMENT RUBRIC ===',
    rubricText || '(Not provided.)',
    '',
    coverageMapText,
    '',
    'Remember: respond with ONLY the JSON object described in your system instructions — no other text.',
  ].join('\n')
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

export async function reviewAssignment({ studentText, briefText, rubricText }) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env before using this feature.')
  }

  const coverageMap = await retrieveCoverageMap(studentText)
  const coverageMapText = formatCoverageMap(coverageMap)

  const model = process.env.DEEPSEEK_MODEL || 'claude-sonnet-4-5'
  const client = new Anthropic({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL })

  // Reverted after a real-request test: DeepSeek's Anthropic-compatible endpoint ignores
  // `budget_tokens`, so reasoning length isn't controllable — on this app's system prompt
  // it consumed the entire max_tokens budget on thinking alone and never produced the
  // required JSON. See the conversation/PR notes before re-enabling `thinking`.
  //
  // temperature: 0 — this was previously unset, meaning the endpoint's default (non-zero)
  // sampling temperature applied. Confirmed by testing that this was the actual cause of
  // the same assignment getting different criteria/status on repeated submissions.
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage({ studentText, briefText, rubricText, coverageMapText }) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new Error('The AI response did not contain a text block.')
  }
  const cleanedText = stripCodeFences(textBlock.text)

  let parsed
  try {
    parsed = JSON.parse(cleanedText)
  } catch {
    console.error('AI response was not valid JSON:', textBlock.text)
    throw new Error('The AI response was not valid JSON.')
  }

  if (!Array.isArray(parsed.criteriaCoverage)) {
    throw new Error('The AI response did not match the expected schema.')
  }

  return parsed
}
