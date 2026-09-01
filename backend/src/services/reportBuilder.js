const VALID_STATUSES = new Set(['Fully Covered', 'Partially Covered', 'Not Covered'])

// The AI sometimes returns a near-miss value instead of one of the 3 exact strings above
// (e.g. it confuses the criteriaCoverage status with the criticalIssues/importantIssues
// severity vocabulary). Rather than rejecting the whole report over one stray word, map
// known near-misses to the closest valid status.
const STATUS_ALIASES = {
  critical: 'Not Covered',
  important: 'Partially Covered',
  fully: 'Fully Covered',
  full: 'Fully Covered',
  complete: 'Fully Covered',
  completed: 'Fully Covered',
  met: 'Fully Covered',
  covered: 'Fully Covered',
  partial: 'Partially Covered',
  partially: 'Partially Covered',
  'in progress': 'Partially Covered',
  'not met': 'Not Covered',
  unmet: 'Not Covered',
  missing: 'Not Covered',
  none: 'Not Covered',
  'not present': 'Not Covered',
  absent: 'Not Covered',
}

const DEFAULT_REVIEWER_NOTE = 'لم يقدّم المراجع ملاحظة تفصيلية لهذا الجانب.'

const VALID_PARAGRAPH_STATUSES = new Set(['Strong', 'Needs Improvement', 'Weak'])
const MAX_PARAGRAPH_ENTRIES = 25

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// anchorText is strictly optional: it is a verbatim quote from the student's document that
// lets the report jump to the spot, and the prompt asks for null whenever an issue has no
// single place in the text. Anything that is not a usable string — missing, null, a stray
// number, the literal "null", or whitespace — collapses to null. It must never be a reason
// to reject an otherwise valid report, so this normalizes rather than validates.
function normalizeAnchorText(rawAnchorText) {
  if (typeof rawAnchorText !== 'string') return null
  const trimmed = rawAnchorText.trim()
  if (!trimmed || trimmed.toLowerCase() === 'null') return null
  return trimmed
}

// paragraphAnalysis is an enhancement, never a precondition: a report without it is still a
// complete, valid report (and every report generated before this field existed is exactly
// that). So this drops individual malformed entries instead of failing the whole review, and
// returns [] when the field is absent — the UI hides the section when the array is empty.
function normalizeParagraphAnalysis(rawParagraphAnalysis) {
  if (!Array.isArray(rawParagraphAnalysis)) return []

  const cleaned = []

  for (const entry of rawParagraphAnalysis) {
    const anchorText = normalizeAnchorText(entry?.anchorText)
    // Without an anchor the row cannot be labelled or jumped to, so it has nothing to offer.
    if (!anchorText) continue
    if (!VALID_PARAGRAPH_STATUSES.has(entry?.status)) continue
    if (!isNonEmptyString(entry?.comment)) continue

    cleaned.push({
      anchorText,
      section: isNonEmptyString(entry?.section) ? entry.section.trim() : null,
      status: entry.status,
      comment: entry.comment.trim(),
    })

    if (cleaned.length === MAX_PARAGRAPH_ENTRIES) break
  }

  if (Array.isArray(rawParagraphAnalysis) && cleaned.length < rawParagraphAnalysis.length) {
    console.warn(
      `paragraphAnalysis: kept ${cleaned.length} of ${rawParagraphAnalysis.length} entries (dropped malformed or over the ${MAX_PARAGRAPH_ENTRIES} cap).`,
    )
  }

  return cleaned
}

function normalizeStatus(rawStatus) {
  if (typeof rawStatus !== 'string') return null
  const trimmed = rawStatus.trim()
  if (VALID_STATUSES.has(trimmed)) return trimmed
  return STATUS_ALIASES[trimmed.toLowerCase()] || null
}

export function buildReport(rawAiResponse) {
  if (!isNonEmptyString(rawAiResponse?.executiveSummary)) {
    return { valid: false, reason: 'AI response missing executiveSummary.' }
  }

  // An empty strengths array used to fail the whole review. That rejected a CORRECT analysis:
  // when the submission has no real content, "no strengths" is the honest finding, and the
  // model returns [] along with 14 "Not Covered" criteria. Throwing a 500 at that point loses
  // an otherwise complete and accurate report over its most defensible field. The array must
  // still exist and hold strings; it just no longer has to be non-empty, and the report page
  // omits the strengths card when there are none.
  if (!Array.isArray(rawAiResponse.strengths)) {
    return { valid: false, reason: 'AI response missing strengths array.' }
  }

  const strengths = rawAiResponse.strengths.filter(isNonEmptyString)
  if (strengths.length === 0) {
    console.warn('strengths came back empty — keeping the report and hiding that section.')
  }

  if (!Array.isArray(rawAiResponse.criteriaCoverage) || rawAiResponse.criteriaCoverage.length !== 14) {
    return {
      valid: false,
      reason: 'AI response criteriaCoverage must contain exactly 14 items, got ' +
        (Array.isArray(rawAiResponse.criteriaCoverage) ? rawAiResponse.criteriaCoverage.length : 0) + '.',
    }
  }

  for (let i = 0; i < rawAiResponse.criteriaCoverage.length; i++) {
    const item = rawAiResponse.criteriaCoverage[i]

    const normalizedStatus = normalizeStatus(item?.status)
    if (normalizedStatus && normalizedStatus !== item?.status) {
      console.warn(
        `criteriaCoverage[${i}] ("${item?.name}") had non-standard status "${item?.status}" — normalized to "${normalizedStatus}".`,
      )
    }
    if (normalizedStatus) {
      item.status = normalizedStatus
    }

    const idValid = typeof item?.id === 'number' && item.id >= 1 && item.id <= 14
    const nameValid = isNonEmptyString(item?.name)
    const statusValid = VALID_STATUSES.has(item?.status)
    const commentValid = isNonEmptyString(item?.comment)
    if (!idValid || !nameValid || !statusValid || !commentValid) {
      return { valid: false, reason: 'criteriaCoverage item at index ' + i + ' is malformed.' }
    }
  }

  if (!Array.isArray(rawAiResponse.criticalIssues) || !Array.isArray(rawAiResponse.importantIssues)) {
    return { valid: false, reason: 'criticalIssues/importantIssues must be arrays (can be empty).' }
  }

  for (let i = 0; i < rawAiResponse.criticalIssues.length; i++) {
    const item = rawAiResponse.criticalIssues[i]
    if (!isNonEmptyString(item?.issue) || !isNonEmptyString(item?.location) || !isNonEmptyString(item?.requiredAction)) {
      return { valid: false, reason: 'criticalIssues item at index ' + i + ' is malformed.' }
    }
    item.anchorText = normalizeAnchorText(item.anchorText)
  }

  for (let i = 0; i < rawAiResponse.importantIssues.length; i++) {
    const item = rawAiResponse.importantIssues[i]
    if (!isNonEmptyString(item?.issue) || !isNonEmptyString(item?.suggestedAction)) {
      return { valid: false, reason: 'importantIssues item at index ' + i + ' is malformed.' }
    }
    item.anchorText = normalizeAnchorText(item.anchorText)
  }

  if (
    !Array.isArray(rawAiResponse.topPriorityActions) ||
    rawAiResponse.topPriorityActions.length < 1 ||
    rawAiResponse.topPriorityActions.length > 5
  ) {
    return { valid: false, reason: 'topPriorityActions must contain 1 to 5 items.' }
  }

  // The AI occasionally drops a reviewerNotes key entirely instead of returning an empty
  // string for it. Rather than rejecting the whole report, fill in a neutral placeholder
  // for any missing note field (and "" for disagreements, which is legitimately optional).
  const rawReviewerNotes =
    rawAiResponse.reviewerNotes && typeof rawAiResponse.reviewerNotes === 'object' ? rawAiResponse.reviewerNotes : {}

  for (const key of ['contentAccuracy', 'evidenceSources', 'clarityIntegrity', 'disagreements']) {
    if (typeof rawReviewerNotes[key] !== 'string') {
      console.warn(`reviewerNotes.${key} was missing — filled in a default.`)
    }
  }

  const reviewerNotes = {
    contentAccuracy: isNonEmptyString(rawReviewerNotes.contentAccuracy) ? rawReviewerNotes.contentAccuracy : DEFAULT_REVIEWER_NOTE,
    evidenceSources: isNonEmptyString(rawReviewerNotes.evidenceSources) ? rawReviewerNotes.evidenceSources : DEFAULT_REVIEWER_NOTE,
    clarityIntegrity: isNonEmptyString(rawReviewerNotes.clarityIntegrity) ? rawReviewerNotes.clarityIntegrity : DEFAULT_REVIEWER_NOTE,
    disagreements: typeof rawReviewerNotes.disagreements === 'string' ? rawReviewerNotes.disagreements : '',
  }

  const fullyCoveredCount = rawAiResponse.criteriaCoverage.filter((c) => c.status === 'Fully Covered').length
  const partiallyCoveredCount = rawAiResponse.criteriaCoverage.filter((c) => c.status === 'Partially Covered').length
  const notCoveredCount = rawAiResponse.criteriaCoverage.filter((c) => c.status === 'Not Covered').length

  return {
    valid: true,
    report: {
      executiveSummary: rawAiResponse.executiveSummary.trim(),
      strengths,
      criteriaCoverage: rawAiResponse.criteriaCoverage,
      criticalIssues: rawAiResponse.criticalIssues,
      importantIssues: rawAiResponse.importantIssues,
      paragraphAnalysis: normalizeParagraphAnalysis(rawAiResponse.paragraphAnalysis),
      topPriorityActions: rawAiResponse.topPriorityActions,
      reviewerNotes,
      summary: {
        criticalCount: rawAiResponse.criticalIssues.length,
        importantCount: rawAiResponse.importantIssues.length,
        fullyCoveredCount,
        partiallyCoveredCount,
        notCoveredCount,
      },
    },
  }
}
