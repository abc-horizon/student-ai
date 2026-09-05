// Maps each criteriaCoverage "status" value to the color used for its badge. The status
// strings themselves (from systemPrompt.js) are already the display text — see CriteriaTable
// and CoverageBreakdown — so this only needs to carry the color, not a separate label.
export const STATUS_COLOR = {
  'Fully Covered': 'green',
  'Partially Covered': 'yellow',
  'Not Covered': 'red',
}
