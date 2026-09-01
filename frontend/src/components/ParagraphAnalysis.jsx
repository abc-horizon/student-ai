import { useState } from 'react'

const STATUS_CONFIG = {
  Strong: {
    row: 'border-green-200 bg-green-50/60 hover:bg-green-50',
    badge: 'bg-green-100 text-green-800',
    dot: 'bg-green-500',
  },
  'Needs Improvement': {
    row: 'border-amber-200 bg-amber-50/60 hover:bg-amber-50',
    badge: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-500',
  },
  Weak: {
    row: 'border-red-200 bg-red-50/60 hover:bg-red-50',
    badge: 'bg-red-100 text-red-800',
    dot: 'bg-red-500',
  },
}

const FILTERS = [
  { key: 'all', label: 'All', matches: () => true },
  { key: 'weak', label: 'Weak Only', matches: (item) => item.status === 'Weak' },
  { key: 'needs', label: 'Needs Improvement', matches: (item) => item.status === 'Needs Improvement' },
]

// The anchor doubles as the paragraph's visible label, so it is trimmed for display only —
// the untouched value is what gets handed to onJump for matching.
function previewLabel(anchorText) {
  const collapsed = anchorText.replace(/\s+/g, ' ').trim()
  return collapsed.length > 110 ? `${collapsed.slice(0, 110)}…` : collapsed
}

// Mirrors MAX_PARAGRAPH_ENTRIES in backend/src/services/reportBuilder.js. The prompt also
// asks the model to mention the cut in its first comment, but that instruction is not
// reliably followed — on a long assignment it returned exactly 25 entries with no mention.
// Showing the notice whenever the list is at the ceiling makes it a guarantee instead.
const PARAGRAPH_CAP = 25

function ParagraphAnalysis({ items, onJump }) {
  const [filter, setFilter] = useState('all')

  const activeFilter = FILTERS.find((entry) => entry.key === filter) || FILTERS[0]
  const visible = items.filter((item) => activeFilter.matches(item))

  const counts = {
    all: items.length,
    weak: items.filter((item) => item.status === 'Weak').length,
    needs: items.filter((item) => item.status === 'Needs Improvement').length,
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length >= PARAGRAPH_CAP && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
          This assignment is long, so this section shows only the {PARAGRAPH_CAP} most important paragraphs — not
          every paragraph in the assignment.
        </p>
      )}

      <div className="print-hidden flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            aria-pressed={filter === entry.key}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              filter === entry.key
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {entry.label} ({counts[entry.key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">No paragraphs in this category.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item, index) => {
            const config = STATUS_CONFIG[item.status]
            const canJump = Boolean(onJump && item.anchorText)

            const body = (
              <>
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${config.badge}`}>
                        {item.status}
                      </span>
                      {item.section && <span className="text-xs font-medium text-gray-500">{item.section}</span>}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold leading-relaxed text-gray-900">
                      {previewLabel(item.anchorText)}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.comment}</p>
                  </div>
                  {canJump && (
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs text-blue-700 opacity-70">
                      ⤢
                    </span>
                  )}
                </div>
              </>
            )

            return (
              <li key={`${index}-${item.anchorText.slice(0, 24)}`}>
                {canJump ? (
                  <button
                    type="button"
                    onClick={() => onJump(item.anchorText)}
                    title="Go to this location"
                    className={`w-full rounded-lg border px-3 py-2.5 text-start transition-colors ${config.row}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={`rounded-lg border px-3 py-2.5 ${config.row}`}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ParagraphAnalysis
