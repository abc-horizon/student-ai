import fs from 'fs'
import path from 'path'

// Reference-only: mirrors local_moodle_zoho_sync's official numeric-grade-to-BTEC-letter
// conversion (see backend/src/knowledge/btec-grade-mapping.json for provenance). This is the
// university's real grading scale, unrelated to anything our tool estimates.
const MAPPING_PATH = path.join(import.meta.dirname, '..', 'knowledge', 'btec-grade-mapping.json')
const { rules: GRADE_RULES } = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'))

export function mapNumericGradeToBtecLetter(grade) {
  if (grade === 0) return 'F'
  if (grade === null || grade === undefined) return 'R'
  if (grade >= 4) return 'D'
  if (grade >= 3) return 'M'
  if (grade >= 2) return 'P'
  return 'R'
}

// This function is intentionally NOT wired into the student-facing report (reportBuilder.js /
// aiReviewService.js) and does not read our tool's 14-item generic criteriaCoverage — those
// items aren't tagged with a Pass/Merit/Distinction tier, so mapping them onto BTEC levels
// would be a guess dressed up as an assessment. Callers must supply criteria that already carry
// a real tier, e.g. the { criterion_code, level: 'PASS'|'MERIT'|'DISTINCTION' } shape used by
// backend/src/knowledge/sustainable-energy-rubric.json and the run-eval.mjs BTEC eval pass.
//
// IMPORTANT — this is guidance, not a grade: our tool's ethical guardrails forbid issuing final
// grades. Every result carries isEstimate: true and a disclaimer; callers displaying `level`
// to a student MUST also display `disclaimer` alongside it, worded as an estimate
// ("يقابل تقديرياً مستوى ...") and never presented as an official or final result.
const TIER_LEVEL_MAP = { P: 'PASS', PASS: 'PASS', M: 'MERIT', MERIT: 'MERIT', D: 'DISTINCTION', DISTINCTION: 'DISTINCTION' }

const ESTIMATE_DISCLAIMER =
  'هذا تقدير توجيهي فقط من الأداة، وليس تقييماً رسمياً أو درجة نهائية. الدرجة الرسمية تصدر حصراً من المُقيّم البشري.'

function normalizeTier(rawTier) {
  if (typeof rawTier !== 'string') return null
  return TIER_LEVEL_MAP[rawTier.trim().toUpperCase()] || null
}

/**
 * Estimates an equivalent BTEC level (Distinction / Merit / Pass / Refer) from a set of
 * already-tiered, already-judged criteria.
 *
 * @param {Array<{ tier: string, achieved: boolean }>} criteria - each item's `tier` must be
 *   one of 'P'/'PASS', 'M'/'MERIT', 'D'/'DISTINCTION' (case-insensitive); `achieved` is whether
 *   that criterion was judged met.
 * @returns {{ level: 'Distinction'|'Merit'|'Pass'|'Refer', isEstimate: true, disclaimer: string }}
 */
export function estimateBtecLevel(criteria) {
  const tiered = (Array.isArray(criteria) ? criteria : [])
    .map((c) => ({ tier: normalizeTier(c?.tier), achieved: Boolean(c?.achieved) }))
    .filter((c) => c.tier !== null)

  const passCriteria = tiered.filter((c) => c.tier === 'PASS')
  const meritCriteria = tiered.filter((c) => c.tier === 'MERIT')
  const distinctionCriteria = tiered.filter((c) => c.tier === 'DISTINCTION')

  const allPassAchieved = passCriteria.length > 0 && passCriteria.every((c) => c.achieved)

  let level = 'Refer'
  if (allPassAchieved) {
    const allMeritAchieved = meritCriteria.length > 0 && meritCriteria.every((c) => c.achieved)
    const allDistinctionAchieved = distinctionCriteria.length > 0 && distinctionCriteria.every((c) => c.achieved)

    if (allDistinctionAchieved) {
      level = 'Distinction'
    } else if (allMeritAchieved) {
      level = 'Merit'
    } else {
      level = 'Pass'
    }
  }

  return { level, isEstimate: true, disclaimer: ESTIMATE_DISCLAIMER }
}
