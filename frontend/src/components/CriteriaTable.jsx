import { STATUS_COLOR } from '../utils/criteriaLabels.js'

const BADGE_CLASSES = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red: 'bg-red-100 text-red-800',
}

function StatusBadge({ status }) {
  const classes = BADGE_CLASSES[STATUS_COLOR[status]] || 'bg-gray-100 text-gray-800'

  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${classes}`}>{status}</span>
}

function CriteriaTable({ items }) {
  const sortedItems = [...items].sort((a, b) => a.id - b.id)

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <th className="px-3 py-3 text-left font-semibold">#</th>
            <th className="px-3 py-3 text-left font-semibold">Criterion</th>
            <th className="px-3 py-3 text-left font-semibold">Status</th>
            <th className="px-3 py-3 text-left font-semibold">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedItems.map((item) => (
            <tr key={item.id} className="transition-colors hover:bg-gray-50/70">
              <td className="px-3 py-4 align-top text-gray-500">{item.id}</td>
              <td className="px-3 py-4 align-top font-medium text-gray-900">{item.name}</td>
              <td className="px-3 py-4 align-top">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-3 py-4 align-top leading-relaxed text-gray-700">{item.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default CriteriaTable
