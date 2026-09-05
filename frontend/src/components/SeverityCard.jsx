const VARIANT_CONFIG = {
  critical: {
    icon: '🔴',
    borderClass: 'border-l-4 border-red-500',
    bgClass: 'bg-red-50',
  },
  important: {
    icon: '🟡',
    borderClass: 'border-l-4 border-amber-500',
    bgClass: 'bg-amber-50',
  },
}

function SeverityCard({ variant, data, onJump }) {
  const config = VARIANT_CONFIG[variant]

  // Only issues the AI could tie to a verbatim quote are clickable. When anchorText is null
  // — an absence like missing references, or a document-wide remark — there is nothing to
  // scroll to, so the card stays plain text rather than offering a jump that cannot work.
  const canJump = Boolean(onJump && data.anchorText)

  const issueLine = (
    <>
      <span className="me-2">{config.icon}</span>
      {data.issue}
    </>
  )

  return (
    <div className={`rounded-lg p-4 ${config.borderClass} ${config.bgClass}`}>
      {canJump ? (
        <button
          type="button"
          onClick={() => onJump(data.anchorText)}
          title="Go to this location"
          className="group flex w-full items-start gap-2 text-start font-medium leading-relaxed text-gray-900 hover:text-blue-800"
        >
          <span className="flex-1">{issueLine}</span>
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 rounded px-1 text-xs text-blue-700 opacity-70 transition-opacity group-hover:opacity-100"
          >
            ⤢
          </span>
        </button>
      ) : (
        <p className="font-medium leading-relaxed text-gray-900">{issueLine}</p>
      )}

      {variant === 'critical' ? (
        <div className="mt-3 space-y-1.5 text-sm leading-relaxed text-gray-600">
          <p>
            <span className="font-semibold">Location:</span> {data.location}
          </p>
          <p>
            <span className="font-semibold">Required action:</span> {data.requiredAction}
          </p>
        </div>
      ) : (
        <div className="mt-3 text-sm leading-relaxed text-gray-600">
          <p>
            <span className="font-semibold">Suggestion:</span> {data.suggestedAction}
          </p>
        </div>
      )}
    </div>
  )
}

export default SeverityCard
