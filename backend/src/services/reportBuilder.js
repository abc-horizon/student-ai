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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
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

  if (!Array.isArray(rawAiResponse.strengths) || rawAiResponse.strengths.length < 1) {
    return { valid: false, reason: 'AI response missing or empty strengths array.' }
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
  }

  for (let i = 0; i < rawAiResponse.importantIssues.length; i++) {
    const item = rawAiResponse.importantIssues[i]
    if (!isNonEmptyString(item?.issue) || !isNonEmptyString(item?.suggestedAction)) {
      return { valid: false, reason: 'importantIssues item at index ' + i + ' is malformed.' }
    }
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
      strengths: rawAiResponse.strengths,
      criteriaCoverage: rawAiResponse.criteriaCoverage,
      criticalIssues: rawAiResponse.criticalIssues,
      importantIssues: rawAiResponse.importantIssues,
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
