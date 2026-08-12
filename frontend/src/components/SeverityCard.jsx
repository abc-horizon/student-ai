const VARIANT_CONFIG = {
  critical: {
    icon: '🔴',
    borderClass: 'border-r-4 border-red-500',
    bgClass: 'bg-red-50',
  },
  important: {
    icon: '🟡',
    borderClass: 'border-r-4 border-amber-500',
    bgClass: 'bg-amber-50',
  },
}

function SeverityCard({ variant, data }) {
  const config = VARIANT_CONFIG[variant]

  return (
    <div className={`rounded-lg p-4 ${config.borderClass} ${config.bgClass}`}>
      <p className="font-medium leading-relaxed text-gray-900">
        <span className="me-2">{config.icon}</span>
        {data.issue}
      </p>

      {variant === 'critical' ? (
        <div className="mt-3 space-y-1.5 text-sm leading-relaxed text-gray-600">
          <p>
            <span className="font-semibold">الموقع:</span> {data.location}
          </p>
          <p>
            <span className="font-semibold">الإجراء المطلوب:</span> {data.requiredAction}
          </p>
        </div>
      ) : (
        <div className="mt-3 text-sm leading-relaxed text-gray-600">
          <p>
            <span className="font-semibold">الاقتراح:</span> {data.suggestedAction}
          </p>
        </div>
      )}
    </div>
  )
}

export default SeverityCard
