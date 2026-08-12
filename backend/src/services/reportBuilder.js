const VALID_STATUSES = new Set(['Fully Covered', 'Partially Covered', 'Not Covered'])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
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

  const reviewerNotes = rawAiResponse.reviewerNotes
  const reviewerNotesValid =
    reviewerNotes &&
    typeof reviewerNotes === 'object' &&
    isNonEmptyString(reviewerNotes.contentAccuracy) &&
    isNonEmptyString(reviewerNotes.evidenceSources) &&
    isNonEmptyString(reviewerNotes.clarityIntegrity) &&
    typeof reviewerNotes.disagreements === 'string'
  if (!reviewerNotesValid) {
    return { valid: false, reason: 'reviewerNotes is missing required fields.' }
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
      reviewerNotes: rawAiResponse.reviewerNotes,
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
