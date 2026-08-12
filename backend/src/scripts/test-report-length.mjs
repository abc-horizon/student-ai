import 'dotenv/config'
import { reviewAssignment } from '../services/aiReviewService.js'
import { buildReport } from '../services/reportBuilder.js'

const STUDENT_TEXT = `
Fossil Fuels and Renewable Energy: A Review

Coal, oil and gas are fossil fuels that come from decayed plants and animals buried
underground for millions of years. Coal comes from ancient forests, oil and gas come
from marine organisms. Coal is mined from the surface or underground, oil and gas are
extracted through drilling and sometimes hydraulic fracturing.

These fuels are used for generating electricity, transport, heating and cooking. Oil is
also used to make plastics and other chemical products. Burning fossil fuels releases
carbon dioxide, methane and other gases that trap heat in the atmosphere, causing global
warming and climate change. This leads to rising sea levels, more extreme storms and
heatwaves. Air pollution from burning coal and oil also causes health problems like
asthma and other respiratory diseases because of particulates and toxic pollutants.

Renewable energy sources include solar, wind, hydroelectric, biomass and geothermal
power. Solar panels convert sunlight into electricity. Wind turbines use the kinetic
energy of moving air. Hydroelectric dams use flowing water to spin turbines. Biomass
burns organic material. Each source has different costs and environmental impacts.
Solar and wind have low running costs but need a lot of land and are not always
consistent because the sun does not always shine and the wind does not always blow.
Hydroelectric power is reliable but dams can damage river habitats and displace
communities. Biomass can be carbon neutral but requires careful management of land use.

Nuclear power uses fission of uranium to generate large amounts of electricity without
direct carbon emissions, but it produces radioactive waste that must be stored safely
for a very long time, and there is a risk of accidents.

Comparing renewable sources to fossil fuels, renewables have much lower emissions
overall but the LCOE, or levelised cost of electricity, matters a lot when deciding
which technology to invest in. It think wind and solar are becoming cheaper and more
efficient every year, which is good for the future.

In conclusion, renewable energy is better for the environment. Governments should invest
more in solar and wind.
`.trim()

const results = { checks: [] }

function countSentences(text) {
  if (!text) return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return (trimmed.match(/[.!؟]+(\s|$)/g) || []).length || 1
}

function countWords(text) {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function check(label, condition, detail) {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`${status}: ${label}${detail ? ` (${detail})` : ''}`)
  results.checks.push({ label, status, detail })
}

console.log('Calling reviewAssignment() with the real AI backend — this may take a while...\n')

const aiResult = await reviewAssignment({ studentText: STUDENT_TEXT, briefText: '', rubricText: '' })
const { valid, report, reason } = buildReport(aiResult)

if (!valid) {
  console.error('Report failed validation:', reason)
  console.error(JSON.stringify(aiResult, null, 2))
  process.exitCode = 1
} else {
  console.log('=== FULL REPORT JSON ===\n')
  console.log(JSON.stringify(report, null, 2))

  console.log('\n=== LENGTH CHECKS ===\n')

  check(
    'executiveSummary <= 3 sentences',
    countSentences(report.executiveSummary) <= 3,
    `${countSentences(report.executiveSummary)} sentence(s), ${countWords(report.executiveSummary)} words`,
  )

  report.criteriaCoverage.forEach((item) => {
    check(
      `criteriaCoverage[${item.id}] comment is 1 sentence`,
      countSentences(item.comment) <= 1,
      `"${item.name}": ${countWords(item.comment)} words — "${item.comment}"`,
    )
  })

  report.strengths.forEach((s, i) => {
    check(`strengths[${i}] is 1 short sentence`, countSentences(s) <= 1, `${countWords(s)} words — "${s}"`)
  })

  report.criticalIssues.forEach((issue, i) => {
    check(
      `criticalIssues[${i}] issue+action are 1 sentence each`,
      countSentences(issue.issue) <= 1 && countSentences(issue.requiredAction) <= 1,
      `issue: ${countWords(issue.issue)}w, location: "${issue.location}", action: ${countWords(issue.requiredAction)}w`,
    )
  })

  report.importantIssues.forEach((issue, i) => {
    check(
      `importantIssues[${i}] issue+action are 1 sentence each`,
      countSentences(issue.issue) <= 1 && countSentences(issue.suggestedAction) <= 1,
      `issue: ${countWords(issue.issue)}w, action: ${countWords(issue.suggestedAction)}w`,
    )
  })

  const allText = [
    report.executiveSummary,
    ...report.strengths,
    ...report.criteriaCoverage.map((c) => c.comment),
    ...report.criticalIssues.flatMap((i) => [i.issue, i.location, i.requiredAction]),
    ...report.importantIssues.flatMap((i) => [i.issue, i.suggestedAction]),
    ...report.topPriorityActions,
    report.reviewerNotes.contentAccuracy,
    report.reviewerNotes.evidenceSources,
    report.reviewerNotes.clarityIntegrity,
    report.reviewerNotes.disagreements,
  ].join(' ')

  const totalWords = countWords(allText)
  console.log(`\nTotal words across all report text fields: ${totalWords} (rough target: ~350-550 for one page)`)

  const failed = results.checks.filter((c) => c.status === 'FAIL').length
  console.log(`\n${failed === 0 ? 'All length checks passed.' : `${failed} check(s) failed.`}`)
  process.exitCode = failed === 0 ? 0 : 1
}
