import { buildReport } from '../services/reportBuilder.js'

function makeCriteria(overrides = {}) {
  const names = [
    'Task Achievement',
    'Assessment Criteria Coverage',
    'Content Quality',
    'Critical Thinking & Analysis',
    'Organization & Structure',
    'Academic Writing',
    'Evidence & Supporting Arguments',
    'References & Citations',
    'Conceptual Confusion Detection',
    'Worked Examples Presence',
    'Issue Severity Classification',
    'Three-Reviewer Methodology Application',
    'Descriptive vs Critical Analysis Separation',
    'Near-Copied Passage Flagging',
  ]
  return names.map((name, i) => ({
    id: i + 1,
    name,
    status: overrides[i + 1] || 'Fully Covered',
    comment: 'تعليق تجريبي.',
  }))
}

const BASE = {
  executiveSummary: 'ملخص تجريبي.',
  strengths: ['نقطة قوة تجريبية.'],
  criticalIssues: [],
  importantIssues: [],
  topPriorityActions: ['إجراء تجريبي.'],
}

let failures = 0
function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`)
  if (!condition) failures++
}

// Case from the bug report: criterion 9 (index 8) returns "Critical" instead of a valid status.
{
  const input = {
    ...BASE,
    criteriaCoverage: makeCriteria({ 9: 'Critical' }),
    reviewerNotes: {
      contentAccuracy: 'ملاحظة.',
      evidenceSources: 'ملاحظة.',
      clarityIntegrity: 'ملاحظة.',
      disagreements: '',
    },
  }
  const { valid, report, reason } = buildReport(input)
  check('report with status="Critical" on criterion 9 is still accepted', valid)
  if (valid) {
    check('criterion 9 status was normalized to "Not Covered"', report.criteriaCoverage[8].status === 'Not Covered')
  } else {
    console.log('  reason:', reason)
  }
}

// Case from the bug report: reviewerNotes missing the "disagreements" key entirely.
{
  const input = {
    ...BASE,
    criteriaCoverage: makeCriteria(),
    reviewerNotes: {
      contentAccuracy: 'ملاحظة.',
      evidenceSources: 'ملاحظة.',
      // clarityIntegrity intentionally omitted too, to test a double-missing case
    },
  }
  const { valid, report, reason } = buildReport(input)
  check('report with missing reviewerNotes.disagreements + clarityIntegrity is still accepted', valid)
  if (valid) {
    check('disagreements defaulted to ""', report.reviewerNotes.disagreements === '')
    check('clarityIntegrity got a non-empty fallback', report.reviewerNotes.clarityIntegrity.length > 0)
  } else {
    console.log('  reason:', reason)
  }
}

// Sanity: a genuinely nonsensical status (not a known alias) must still fail, not be silently accepted.
{
  const input = {
    ...BASE,
    criteriaCoverage: makeCriteria({ 3: 'Banana' }),
    reviewerNotes: {
      contentAccuracy: 'ملاحظة.',
      evidenceSources: 'ملاحظة.',
      clarityIntegrity: 'ملاحظة.',
      disagreements: '',
    },
  }
  const { valid, reason } = buildReport(input)
  check('report with a nonsensical status ("Banana") is correctly rejected', !valid)
  if (!valid) console.log('  reason:', reason)
}

console.log(`\n${failures === 0 ? 'All fallback unit checks passed.' : `${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
