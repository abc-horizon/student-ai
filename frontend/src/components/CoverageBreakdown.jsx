// Purely a re-presentation of report.criteriaCoverage — the same array the criteria
// table below it renders. No extra request, no AI call: this groups what the report
// already contains so the student can see at a glance which criteria need work and
// where. The `comment` carries the AI's pointer to the spot in the document, so it is
// shown for the two groups that require action and omitted for the ones already fine.
// Exported so the summary stat chips at the top of the report can scroll straight to the
// matching group here instead of opening a popup.
export const COVERAGE_SECTION_IDS = {
  fullyCovered: 'coverage-group-fully-covered',
  partiallyCovered: 'coverage-group-partially-covered',
  notCovered: 'coverage-group-not-covered',
}

const GROUPS = [
  {
    status: 'Fully Covered',
    id: COVERAGE_SECTION_IDS.fullyCovered,
    title: 'Fully Covered',
    icon: '✅',
    showComment: false,
    box: 'border-green-200 bg-green-50/70',
    heading: 'text-green-900',
    counter: 'bg-green-100 text-green-800',
    item: 'border-green-100 bg-white/80',
  },
  {
    status: 'Partially Covered',
    id: COVERAGE_SECTION_IDS.partiallyCovered,
    title: 'Needs Improvement',
    icon: '⚠️',
    showComment: true,
    box: 'border-amber-200 bg-amber-50/70',
    heading: 'text-amber-900',
    counter: 'bg-amber-100 text-amber-900',
    item: 'border-amber-100 bg-white/80',
  },
  {
    status: 'Not Covered',
    id: COVERAGE_SECTION_IDS.notCovered,
    title: 'Not Covered',
    icon: '❌',
    showComment: true,
    box: 'border-red-200 bg-red-50/70',
    heading: 'text-red-900',
    counter: 'bg-red-100 text-red-800',
    item: 'border-red-100 bg-white/80',
  },
]

function CoverageBreakdown({ items }) {
  const byStatus = new Map(GROUPS.map((group) => [group.status, []]))

  for (const item of [...items].sort((a, b) => a.id - b.id)) {
    byStatus.get(item.status)?.push(item)
  }

  const populated = GROUPS.map((group) => ({ group, entries: byStatus.get(group.status) })).filter(
    ({ entries }) => entries.length > 0,
  )

  if (populated.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      {populated.map(({ group, entries }) => (
        <section key={group.status} id={group.id} className={`scroll-mt-6 rounded-xl border p-4 ${group.box}`}>
          <h3 className={`mb-3 flex items-center gap-2 text-base font-bold ${group.heading}`}>
            <span aria-hidden="true">{group.icon}</span>
            <span>{group.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${group.counter}`}>{entries.length}</span>
          </h3>

          <ul className={group.showComment ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2'}>
            {entries.map((entry) => (
              <li key={entry.id} className={`rounded-lg border px-3 py-2 ${group.item}`}>
                <span className="text-sm font-semibold text-gray-900">{entry.name}</span>
                {group.showComment && entry.comment && (
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{entry.comment}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default CoverageBreakdown
