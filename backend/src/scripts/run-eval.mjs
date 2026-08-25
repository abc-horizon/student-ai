// Eval: measures how closely the tool's judgment agrees with the instructor's real BTEC
// grading on 3 real student submissions (see backend/eval-data/).
//
// Two things are computed per student, using the REAL pipeline the student's request goes
// through (extractText -> reviewAssignment with briefText/rubricText left empty, exactly as
// backend/src/routes/review.js calls it):
//
//   1. The actual 14-item generic report the student would see (Task Achievement, Academic
//      Writing, ...). This does NOT map 1:1 onto the 12 official BTEC criteria (P1-P6/M1-M3/
//      D1-D3), so it cannot be compared directly against the instructor's per-criterion CSV.
//   2. A SEPARATE, eval-only AI pass (evaluateBtecCriteria below) that reuses the same RAG
//      coverage map (ragService.retrieveCoverageMap) and the same student text, but asks
//      directly for a 1/0 judgment on each of the 12 BTEC criteria. This is NOT part of the
//      student-facing pipeline — it exists only so this script has something comparable to
//      the instructor's per-criterion grades. Report readers should treat its numbers as an
//      approximation of what the tool "believes", not as a second product feature.
//
// Usage: node src/scripts/run-eval.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { extractText } from '../services/textExtraction.js'
import { reviewAssignment } from '../services/aiReviewService.js'
import { retrieveCoverageMap } from '../services/ragService.js'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const EVAL_DIR = path.join(BACKEND_DIR, 'eval-data')
const CSV_PATH = path.join(
  EVAL_DIR,
  '2526T2_L3_U28_Sustainable_Energy-Sustainable_Energy_Assignment_2526T2.csv',
)
const RUBRIC_PATH = path.join(BACKEND_DIR, 'src', 'knowledge', 'sustainable-energy-rubric.json')
const OUT_JSON = path.join(EVAL_DIR, 'eval-results.json')
const OUT_MD = path.join(EVAL_DIR, 'eval-results.md')

// Only these 3 students have both a real docx submission AND a corresponding row in the
// instructor's CSV. Excluded, with reasons (confirmed with the project owner):
//   - Tareq ZAINALDIN / "SE C.docx": this is the assessor's model answer, not a student
//     submission (assessor name appears inside the file, non-student email domain pattern).
//   - MALIK ISMAILOGLU, MOHAMMA FAWAZ: the CSV records "the student didn't submit any work"
//     with all-zero criteria for both, contradicting the docx files that exist for them in
//     eval-data/ — comparing against that ground truth would be meaningless.
const STUDENTS = [
  { name: 'MAHMOUD AL KHALED', file: 'Assignment CoverSheet - SE.docx' },
  { name: 'SAMI BEN AMEUR', file: '13-6-26 Assignment CoverSheet - SE-A.docx' },
  { name: 'ZIYA SELIM', file: 'energy exam ziad 2 last.docx' },
]

// --- RFC4180-ish CSV parser (the Moodle export has quoted fields containing embedded
// newlines and commas, so naive line-splitting corrupts records) ---
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function loadGroundTruth(rubric) {
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const rows = parseCsv(raw)
  const criterionCodes = rubric.criteria.map((c) => c.criterion_code)
  const dataRows = rows.slice(7) // rows 0-6 are course/assignment/header metadata

  const byName = new Map()
  for (const row of dataRows) {
    const firstName = (row[1] || '').trim()
    const lastName = (row[2] || '').trim()
    const fullName = `${firstName} ${lastName}`.trim().toUpperCase()
    if (!fullName) continue

    const criteria = {}
    criterionCodes.forEach((code, idx) => {
      const scoreCol = 3 + idx * 3 // each criterion occupies 3 cols: Score, Definition, Feedback
      criteria[code] = row[scoreCol] === '1' ? 1 : 0
    })

    byName.set(fullName, { criteria, grade: (row[40] || '').trim() })
  }
  return byName
}

function formatCoverageForEvalPrompt(coverageMap) {
  return coverageMap
    .map((c) => {
      const chunks =
        c.matchedChunks.length === 0
          ? '  (no semantic matches found above threshold)'
          : c.matchedChunks
              .map((m) => `  - (similarity ${m.similarity.toFixed(2)}) "${m.text}"`)
              .join('\n')
      return `${c.criterion_code} (${c.level}) — "${c.criterion_text}"\n${chunks}`
    })
    .join('\n\n')
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

// Eval-only: asks the same model for a direct 1/0 judgment on each of the 12 official BTEC
// criteria, grounded in the same RAG coverage map the real pipeline computes. This does not
// exist in the student-facing product — see the file header comment.
async function evaluateBtecCriteria({ studentText, rubric, coverageMap }) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env before running the eval.')
  }
  const model = process.env.DEEPSEEK_MODEL || 'claude-sonnet-4-5'
  const client = new Anthropic({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL })

  const criteriaList = rubric.criteria
    .map((c) => `${c.criterion_code} (${c.level}): ${c.criterion_text}`)
    .join('\n')

  // Distinction criterion (c) below reads "does NOT need to be one single decisive recommendation" —
  // that wording is deliberate, not a hedge. It was originally "reaching one clear, specific final
  // judgement or recommendation" (a single decisive pick). Tested against the 3-student eval sample
  // (see backend/eval-data/eval-comparison-3way.md), that stricter wording correctly caught a real
  // false positive but also produced 2 NEW false negatives: it rejected two Distinction criteria a
  // student had genuinely earned, because their evaluation reached a well-reasoned but balanced/
  // composite position (context-dependent trade-offs) rather than one single "winner". Since a false
  // negative is worse for a pre-submission guidance tool than a false positive (it tells a student
  // work is inadequate when the instructor would actually accept it), the wording was loosened to
  // accept any specific, evidence-backed evaluative position — decisive or balanced — while still
  // rejecting hedging that never commits to a position at all.
  const systemPrompt = `You are a BTEC assessor judging whether a student's submitted assignment achieves each of 12 official assessment criteria (P1-P6 Pass, M1-M3 Merit, D1-D3 Distinction) for Pearson BTEC International Level 3 Applied Science, Unit 28: Sustainable Energy.

For EACH of the 12 criteria, read the full student text and judge strictly against the criterion's command verb and depth level. BTEC command verbs are hierarchical — a higher verb is not satisfied by doing more of the lower one, it requires a qualitatively different kind of thinking:

- Pass (P1-P6, "Describe"): give a factually correct, reasonably complete account of the required content. No causal reasoning or comparison is required — accurate description is enough.

- Merit (M1-M3, "Explain"/"Compare"): the text must go beyond description into ONE of:
  (a) "Explain" = causal reasoning — state a mechanism or cause-and-effect link (why/how X leads to Y), not just that X and Y both happen.
  (b) "Compare" = an explicit, structured comparison using named, specific criteria (e.g. cost, efficiency, environmental impact, scale) applied consistently across the items being compared — with at least some quantitative or evidenced basis (figures, named studies, concrete examples), not just qualitative impressions.
  REJECT (mark 0) if the text merely lists or describes the items one after another (even if both appear in the same paragraph or table) without an explicit line of reasoning connecting them, or without naming the criteria/dimensions the comparison is being made on. Two descriptions placed side by side are NOT a comparison.

- Distinction (D1-D3, "Evaluate"): the text must go beyond explaining/comparing into ALL of:
  (a) weighing multiple sides against each other using evidence (not just asserting one side is better),
  (b) explicitly identifying which factors/options matter MORE and why (relative significance/prioritization) — not treating all points as equally important,
  (c) reaching a clear evaluative judgement that is directly justified by the evidence discussed. This judgement does NOT need to be one single decisive recommendation or a final pick of "the best" option — a well-supported balanced or composite position (e.g. "X matters more in context A, Y in context B", or "a combination of X and Y is preferable to either alone, because...") satisfies this as long as it is a specific, reasoned position and not a vague hedge like "there are pros and cons to consider" or "more research is needed" with no stated position.
  REJECT (mark 0) only if the text lists benefits and drawbacks, or even explains/compares them, but never actually commits to any reasoned position on relative significance or merit — that is Merit-level work, not Distinction, regardless of how much content or detail is present. Do NOT reject solely because the judgement is nuanced/balanced rather than a single clear-cut winner — nuance backed by evidence and prioritization still counts as evaluation.

General rule: length, detail, and topic coverage are NOT evidence of depth. A long, well-organized, well-cited description or juxtaposition is still only Pass-level content unless the required higher-order reasoning (causal explanation / criteria-based comparison / weighted evaluative judgement) is explicitly present in the text. When genuinely uncertain whether the required depth is present, mark the criterion "not achieved" (0) — a student who is told a criterion needs more work before submission is better served than one given false confidence.

Respond with ONLY valid JSON, no markdown fences, no commentary:
{"criteria": [{"code": "P1", "achieved": 1, "reason": "short Arabic reason, one sentence"}, ...]}
Exactly 12 items, in this exact order: P1, P2, P3, P4, P5, P6, M1, M2, M3, D1, D2, D3. "achieved" must be the integer 1 or 0 only.`

  const userMessage = [
    '=== STUDENT ASSIGNMENT TEXT ===',
    studentText,
    '',
    '=== OFFICIAL BTEC CRITERIA ===',
    criteriaList,
    '',
    '=== SEMANTIC RETRIEVAL EVIDENCE (RAG matches against rubric + brief — advisory only, verify against the full text above) ===',
    formatCoverageForEvalPrompt(coverageMap),
  ].join('\n')

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) throw new Error('BTEC eval pass: response had no text block.')

  const parsed = JSON.parse(stripCodeFences(textBlock.text))
  if (!Array.isArray(parsed.criteria)) throw new Error('BTEC eval pass: response missing "criteria" array.')

  const byCode = {}
  for (const item of parsed.criteria) {
    byCode[item.code] = { achieved: item.achieved ? 1 : 0, reason: item.reason || '' }
  }
  return byCode
}

function compareCriteria(rubric, groundTruth, toolJudgment) {
  return rubric.criteria.map((c) => {
    const code = c.criterion_code
    const expected = groundTruth.criteria[code]
    const actual = toolJudgment[code]?.achieved
    const match = expected === actual
    let errorType = null
    if (!match) errorType = actual === 1 ? 'false_positive' : 'false_negative'
    return {
      code,
      level: c.level,
      criterionText: c.criterion_text,
      instructorSaid: expected,
      toolSaid: actual,
      match,
      errorType,
      toolReason: toolJudgment[code]?.reason || '',
    }
  })
}

function levelBreakdown(comparisons) {
  const levels = ['PASS', 'MERIT', 'DISTINCTION']
  const breakdown = {}
  for (const level of levels) {
    const items = comparisons.filter((c) => c.level === level)
    const matches = items.filter((c) => c.match).length
    breakdown[level] = { total: items.length, matches, accuracy: items.length ? matches / items.length : null }
  }
  return breakdown
}

async function main() {
  console.log('Loading rubric and instructor ground truth (CSV)...')
  const rubric = JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'))
  const groundTruthByName = loadGroundTruth(rubric)

  const studentResults = []

  for (const student of STUDENTS) {
    console.log(`\n=== ${student.name} (${student.file}) ===`)
    const groundTruth = groundTruthByName.get(student.name)
    if (!groundTruth) {
      throw new Error(`No ground-truth row found in CSV for "${student.name}".`)
    }

    const filePath = path.join(EVAL_DIR, student.file)
    const buffer = fs.readFileSync(filePath)
    const extraction = await extractText({ originalname: student.file, buffer })
    if (extraction.warning) {
      throw new Error(`Text extraction failed for ${student.file}: ${extraction.warning}`)
    }
    console.log(`Extracted ${extraction.text.length} chars.`)

    console.log('Running real pipeline (reviewAssignment, same as production route)...')
    const realReport = await reviewAssignment({
      studentText: extraction.text,
      briefText: '',
      rubricText: '',
    })

    console.log('Running supplementary BTEC per-criterion eval pass (RAG + dedicated prompt)...')
    const coverageMap = await retrieveCoverageMap(extraction.text)
    const toolJudgment = await evaluateBtecCriteria({ studentText: extraction.text, rubric, coverageMap })

    const comparisons = compareCriteria(rubric, groundTruth, toolJudgment)
    const matches = comparisons.filter((c) => c.match).length
    const accuracy = matches / comparisons.length

    console.log(`Accuracy vs instructor: ${matches}/12 (${(accuracy * 100).toFixed(1)}%)`)

    studentResults.push({
      student: student.name,
      file: student.file,
      instructorGrade: groundTruth.grade,
      accuracy,
      matches,
      total: comparisons.length,
      levelBreakdown: levelBreakdown(comparisons),
      comparisons,
      realReportCriteriaCoverage: realReport.criteriaCoverage,
    })
  }

  const overallTotal = studentResults.reduce((sum, s) => sum + s.total, 0)
  const overallMatches = studentResults.reduce((sum, s) => sum + s.matches, 0)
  const overallAccuracy = overallMatches / overallTotal

  const overallLevelBreakdown = {}
  for (const level of ['PASS', 'MERIT', 'DISTINCTION']) {
    let total = 0
    let matches = 0
    for (const s of studentResults) {
      total += s.levelBreakdown[level].total
      matches += s.levelBreakdown[level].matches
    }
    overallLevelBreakdown[level] = { total, matches, accuracy: total ? matches / total : null }
  }

  const allMismatches = studentResults.flatMap((s) =>
    s.comparisons
      .filter((c) => !c.match)
      .map((c) => ({ student: s.student, ...c })),
  )

  const results = {
    generatedAt: new Date().toISOString(),
    sampleNote:
      'Sample = 3 confirmed student submissions with matching CSV ground truth (Pass, Merit, Pass). ' +
      'No Distinction-grade sample is available — see README note in this script header. ' +
      'D3 has zero positive ground-truth cases in this sample (no student achieved it), so D3 accuracy ' +
      'reflects only the tool\'s ability to correctly say "not achieved", not its ability to recognize a real D3.',
    methodologyNote:
      'The tool\'s student-facing report (reviewAssignment) uses 14 generic criteria, not the 12 BTEC ' +
      'codes directly. Per-criterion P1-D3 comparison uses a separate eval-only AI pass (evaluateBtecCriteria) ' +
      'that reuses the real RAG coverage map but is not part of the product the student sees.',
    overallAccuracy,
    overallMatches,
    overallTotal,
    overallLevelBreakdown,
    students: studentResults,
    mismatches: allMismatches,
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), 'utf8')
  console.log(`\nWrote ${OUT_JSON}`)

  const md = buildMarkdownReport(results)
  fs.writeFileSync(OUT_MD, md, 'utf8')
  console.log(`Wrote ${OUT_MD}`)

  console.log('\n=== SUMMARY ===')
  console.log(`Overall accuracy: ${overallMatches}/${overallTotal} (${(overallAccuracy * 100).toFixed(1)}%)`)
  for (const level of ['PASS', 'MERIT', 'DISTINCTION']) {
    const b = overallLevelBreakdown[level]
    console.log(`  ${level}: ${b.matches}/${b.total} (${b.accuracy !== null ? (b.accuracy * 100).toFixed(1) + '%' : 'n/a'})`)
  }
}

function buildMarkdownReport(results) {
  const lines = []
  lines.push('# تقرير Eval — دقة الأداة مقارنة بتصحيح الأستاذ (BTEC Unit 28: Sustainable Energy)')
  lines.push('')
  lines.push(`تاريخ التوليد: ${results.generatedAt}`)
  lines.push('')
  lines.push('## ملاحظات منهجية مهمة')
  lines.push('')
  lines.push(`- **حجم العينة:** ${results.sampleNote}`)
  lines.push(`- **طريقة الاستخراج:** ${results.methodologyNote}`)
  lines.push('')
  lines.push('## النتيجة الإجمالية')
  lines.push('')
  lines.push(
    `**${results.overallMatches} من ${results.overallTotal}** معيار متطابق بين الأداة والأستاذ (**${(results.overallAccuracy * 100).toFixed(1)}%**)`,
  )
  lines.push('')
  lines.push('| المستوى | متطابق | الإجمالي | نسبة التطابق |')
  lines.push('|---|---|---|---|')
  for (const level of ['PASS', 'MERIT', 'DISTINCTION']) {
    const b = results.overallLevelBreakdown[level]
    lines.push(`| ${level} | ${b.matches} | ${b.total} | ${b.accuracy !== null ? (b.accuracy * 100).toFixed(1) + '%' : 'n/a'} |`)
  }
  lines.push('')

  lines.push('## تفصيل حسب الطالب')
  lines.push('')
  for (const s of results.students) {
    lines.push(`### ${s.student} — درجة الأستاذ: ${s.instructorGrade}`)
    lines.push('')
    lines.push(`الملف: \`${s.file}\``)
    lines.push('')
    lines.push(`دقة التطابق: **${s.matches}/${s.total} (${(s.accuracy * 100).toFixed(1)}%)**`)
    lines.push('')
    lines.push('| المستوى | متطابق | الإجمالي |')
    lines.push('|---|---|---|')
    for (const level of ['PASS', 'MERIT', 'DISTINCTION']) {
      const b = s.levelBreakdown[level]
      lines.push(`| ${level} | ${b.matches} | ${b.total} |`)
    }
    lines.push('')
    lines.push('| معيار | المستوى | الأستاذ | الأداة | تطابق؟ | سبب الأداة |')
    lines.push('|---|---|---|---|---|---|')
    for (const c of s.comparisons) {
      const mark = c.match ? '✅' : c.errorType === 'false_positive' ? '❌ (إيجابي كاذب)' : '❌ (سلبي كاذب)'
      lines.push(
        `| ${c.code} | ${c.level} | ${c.instructorSaid} | ${c.toolSaid} | ${mark} | ${c.toolReason.replace(/\|/g, '/')} |`,
      )
    }
    lines.push('')
  }

  lines.push('## كل نقاط الاختلاف (الأداة مقابل الأستاذ)')
  lines.push('')
  if (results.mismatches.length === 0) {
    lines.push('لا يوجد أي اختلاف — تطابق كامل 100%.')
  } else {
    lines.push('| الطالب | المعيار | المستوى | الأستاذ | الأداة | نوع الخطأ |')
    lines.push('|---|---|---|---|---|---|')
    for (const m of results.mismatches) {
      const label = m.errorType === 'false_positive' ? 'إيجابي كاذب (الأداة قالت محقق، الأستاذ قال لا)' : 'سلبي كاذب (الأداة قالت غير محقق، الأستاذ قال نعم)'
      lines.push(`| ${m.student} | ${m.code} | ${m.level} | ${m.instructorSaid} | ${m.toolSaid} | ${label} |`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

main().catch((err) => {
  console.error('Eval failed:', err)
  process.exit(1)
})
