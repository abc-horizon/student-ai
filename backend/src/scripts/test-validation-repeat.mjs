import 'dotenv/config'
import { reviewAssignment } from '../services/aiReviewService.js'
import { buildReport } from '../services/reportBuilder.js'

const RUNS = Number(process.argv[2]) || 6

const STUDENT_TEXTS = [
  `
Fossil Fuels and Renewable Energy: A Review

Coal, oil and gas are fossil fuels that come from decayed plants and animals buried
underground for millions of years. These fuels are used for generating electricity,
transport, heating and cooking. Burning fossil fuels releases carbon dioxide, methane
and other gases that trap heat in the atmosphere, causing global warming.

Renewable energy sources include solar, wind, hydroelectric, biomass and geothermal
power. Each source has different costs and environmental impacts. Solar and wind have
low running costs but need a lot of land. Hydroelectric power is reliable but dams can
damage river habitats.

Nuclear power uses fission of uranium to generate large amounts of electricity without
direct carbon emissions, but it produces radioactive waste.

In conclusion, renewable energy is better for the environment. Governments should
invest more in solar and wind.
`.trim(),
  `
Renewable Energy Sources and Their Impact

Wind turbines convert kinetic energy from air into electricity. Solar panels use the
photovoltaic effect to convert sunlight directly into electricity. Both are considered
clean sources with low operating emissions, but wind farms can affect bird migration and
solar farms require large areas of land.

Biomass energy comes from burning organic material such as wood, crops or waste. It is
sometimes considered carbon neutral, though this depends heavily on how the biomass is
sourced and regrown. Geothermal energy uses heat from within the earth and is very
reliable in volcanically active regions, but is not available everywhere.

Comparing these to fossil fuels, most renewables produce far fewer greenhouse gas
emissions across their lifecycle, but intermittency remains an issue for wind and solar
without adequate storage or grid balancing solutions like batteries or pumped hydro.

Overall I believe a mixed strategy combining several renewable sources alongside grid
storage is the most realistic path forward, though costs and public acceptance vary by
region.
`.trim(),
]

function summarize(report) {
  return {
    strengths: report.strengths.length,
    criteria: report.criteriaCoverage.length,
    statuses: report.criteriaCoverage.map((c) => c.status),
    critical: report.criticalIssues.length,
    important: report.importantIssues.length,
    reviewerNoteKeys: Object.keys(report.reviewerNotes),
  }
}

const results = []

for (let i = 0; i < RUNS; i++) {
  const studentText = STUDENT_TEXTS[i % STUDENT_TEXTS.length]

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))

  let outcome
  try {
    const aiResult = await reviewAssignment({ studentText, briefText: '', rubricText: '' })
    const { valid, report, reason } = buildReport(aiResult)
    outcome = valid
      ? { run: i + 1, valid: true, warnings, summary: summarize(report) }
      : { run: i + 1, valid: false, warnings, reason, raw: aiResult }
  } catch (err) {
    outcome = { run: i + 1, valid: false, warnings, reason: 'threw: ' + err.message }
  } finally {
    console.warn = originalWarn
  }

  results.push(outcome)

  if (outcome.valid) {
    console.log(`Run ${outcome.run}: PASS — statuses=[${outcome.summary.statuses.join(', ')}]`)
  } else {
    console.log(`Run ${outcome.run}: FAIL — ${outcome.reason}`)
  }
  if (outcome.warnings.length > 0) {
    outcome.warnings.forEach((w) => console.log(`  (normalized) ${w}`))
  }
}

const passed = results.filter((r) => r.valid).length
const withNormalization = results.filter((r) => r.warnings.length > 0).length

console.log(`\n=== SUMMARY: ${passed}/${RUNS} runs passed validation ===`)
console.log(`Runs where a fallback/normalization kicked in: ${withNormalization}/${RUNS}`)

const failures = results.filter((r) => !r.valid)
if (failures.length > 0) {
  console.log('\n=== FAILURE DETAILS ===')
  for (const f of failures) {
    console.log(`Run ${f.run}: ${f.reason}`)
    if (f.raw) console.log(JSON.stringify(f.raw, null, 2))
  }
}

process.exitCode = passed === RUNS ? 0 : 1
