import Anthropic from '@anthropic-ai/sdk'
import { getSystemPrompt } from '../prompts/systemPrompt.js'
import { retrieveCoverageMap } from './ragService.js'
import { getAiConfig } from './aiConfigService.js'

// Thrown instead of a plain Error when a failure is plausibly caused by a teacher-editable
// setting (a custom prompt override or additional instructions) rather than the AI service
// itself — see review.js, which uses `err.code` to give a distinct, actionable message instead
// of the generic "AI service error" for these cases.
export class AiConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AiConfigError'
    this.code = 'AI_CONFIG_INVALID'
  }
}

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

// A trailing comma right before a closing ] or } is a common, harmless AI output slip — the
// rest of the response is well-formed, but JSON.parse rejects the whole thing over it. Applied
// unconditionally before every parse attempt (not just after a failure), so cases that haven't
// been observed to error out yet are covered too.
function stripTrailingCommas(text) {
  return text.replace(/,(\s*[\]}])/g, '$1')
}

export async function reviewAssignment({ studentText, briefText, rubricText }) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env before using this feature.')
  }

  const coverageMap = await retrieveCoverageMap(studentText)
  const coverageMapText = formatCoverageMap(coverageMap)

  const config = getAiConfig()
  // When a custom prompt/instructions is active, a failure below is plausibly the teacher's
  // own setting rather than a real AI-service problem — see AiConfigError above.
  const isCustomConfig = Boolean(config.promptOverride || config.additionalInstructions)

  const client = new Anthropic({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL })

  // Reverted after a real-request test: DeepSeek's Anthropic-compatible endpoint ignores
  // `budget_tokens`, so reasoning length isn't controllable — on this app's system prompt
  // it consumed the entire max_tokens budget on thinking alone and never produced the
  // required JSON. See the conversation/PR notes before re-enabling `thinking`.
  //
  // temperature/model/maxTokens now come from ai-config.json (Settings page) instead of being
  // hardcoded — see aiConfigService.js. temperature defaults to 0: this was previously unset,
  // meaning the endpoint's default (non-zero) sampling temperature applied, which was confirmed
  // to be the actual cause of the same assignment getting different criteria/status on repeated
  // submissions.
  const requestParams = {
    model: config.model,
    thinking: { type: 'disabled' },
    temperature: config.temperature,
    system: getSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage({ studentText, briefText, rubricText, coverageMapText }) }],
  }

  // enableTokenLimit (Settings page): when on (default), maxTokens is sent as-is — default
  // 8192, raised from 4096 when paragraphAnalysis was added, since that array can carry up to
  // 25 entries, each holding a verbatim quote, sharing this budget with the whole rest of the
  // report; at 4096 a long assignment truncates the JSON mid-object, which used to surface only
  // as the generic "not valid JSON" error below. When off, max_tokens is omitted from the
  // request entirely (not replaced with a large number) — the response length is unrestricted.
  if (config.enableTokenLimit) {
    requestParams.max_tokens = config.maxTokens
  }

  const response = await client.messages.create(requestParams)

  // Truncation is the one failure mode that produces a *plausible-looking* partial response:
  // the JSON simply stops mid-object and parsing fails several steps later with no hint of
  // the real cause. Naming it here keeps that diagnosis out of the guesswork.
  if (response.stop_reason === 'max_tokens') {
    console.error(
      `[aiReviewService] response hit the max_tokens ceiling — output was truncated. usage=${JSON.stringify(response.usage)}`,
    )
    if (isCustomConfig) {
      throw new AiConfigError(
        'The AI response was cut off before it finished (max_tokens reached). The current Settings (Max Tokens, custom prompt, or additional instructions) are the likely cause — an administrator should review them.',
      )
    }
    throw new Error('The AI response was cut off before it finished (max_tokens reached).')
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new Error('The AI response did not contain a text block.')
  }
  const cleanedText = stripTrailingCommas(stripCodeFences(textBlock.text))

  let parsed
  try {
    parsed = JSON.parse(cleanedText)
  } catch {
    // Log the exact text JSON.parse was actually given (post-sanitization), not just the error
    // message — that's what's needed to diagnose the next new malformed-JSON pattern.
    console.error('AI response was not valid JSON. Full text attempted:', cleanedText)
    if (isCustomConfig) {
      throw new AiConfigError(
        'The current custom AI settings (prompt override or additional instructions) produced a response that is not valid JSON. An administrator should review Settings.',
      )
    }
    throw new Error('The AI response was not valid JSON.')
  }

  if (!Array.isArray(parsed.criteriaCoverage)) {
    if (isCustomConfig) {
      throw new AiConfigError(
        'The current custom AI settings (prompt override or additional instructions) produced a response that does not match the required schema. An administrator should review Settings.',
      )
    }
    throw new Error('The AI response did not match the expected schema.')
  }

  return parsed
}

// Fires one minimal, real request at the given model name so a teacher can confirm it actually
// works from the Settings page before adopting it. Also reports back the model the API says it
// used: DeepSeek's Anthropic-compatible endpoint silently substitutes an unrecognized model
// name with its own default instead of erroring, so a "successful" test can still mean the
// requested model was never actually reached.
export async function testModelConnection(modelName) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return { ok: false, requestedModel: modelName, error: 'DEEPSEEK_API_KEY is not set on the server.' }
  }

  const client = new Anthropic({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL })

  try {
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 32,
      thinking: { type: 'disabled' },
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    const resolvedModel = response.model || null
    const modelMismatch = Boolean(resolvedModel && resolvedModel !== modelName)

    return {
      ok: true,
      requestedModel: modelName,
      resolvedModel,
      modelMismatch,
      sampleReply: textBlock?.text?.trim() || null,
    }
  } catch (err) {
    return { ok: false, requestedModel: modelName, error: err.message }
  }
}
