import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReview } from '../context/ReviewContext.jsx'
import CriteriaTable from '../components/CriteriaTable.jsx'
import SeverityCard from '../components/SeverityCard.jsx'
import GuardrailStatusBadge from '../components/GuardrailStatusBadge.jsx'

const STAT_TONE_CLASSES = {
  fullyCovered: { box: 'bg-green-50 ring-green-200', text: 'text-green-700' },
  partiallyCovered: { box: 'bg-amber-50 ring-amber-200', text: 'text-amber-700' },
  notCovered: { box: 'bg-gray-50 ring-gray-200', text: 'text-gray-700' },
  critical: { box: 'bg-red-50 ring-red-200', text: 'text-red-700' },
}

function StatChip({ label, value, tone }) {
  const { box, text } = STAT_TONE_CLASSES[tone]

  return (
    <div className={`rounded-xl p-4 text-center ring-1 ${box}`}>
      <div className={`text-2xl font-bold ${text}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-600">{label}</div>
    </div>
  )
}

const CARD_BORDER_CLASSES = {
  neutral: 'border-gray-100',
  critical: 'border-red-100',
  important: 'border-amber-100',
  success: 'border-green-100',
}

const ICON_BADGE_CLASSES = {
  neutral: 'bg-blue-50 text-blue-700',
  critical: 'bg-red-100 text-red-700',
  important: 'bg-amber-100 text-amber-700',
  success: 'bg-green-100 text-green-700',
}

function Card({ title, icon, accent = 'neutral', children }) {
  return (
    <section className={`rounded-2xl border bg-white p-6 shadow-sm ${CARD_BORDER_CLASSES[accent]}`}>
      <div className="mb-4 flex items-center gap-3 border-b border-gray-100 pb-4">
        {icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${ICON_BADGE_CLASSES[accent]}`}
          >
            {icon}
          </span>
        )}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ReportPage() {
  const navigate = useNavigate()
  const { report } = useReview()

  useEffect(() => {
    if (!report) {
      navigate('/')
    }
  }, [report, navigate])

  if (!report) {
    return null
  }

  const { summary, reviewerNotes } = report

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip label="مُغطى بالكامل" value={summary.fullyCoveredCount} tone="fullyCovered" />
          <StatChip label="مُغطى جزئيًا" value={summary.partiallyCoveredCount} tone="partiallyCovered" />
          <StatChip label="غير مُغطى" value={summary.notCoveredCount} tone="notCovered" />
          <StatChip label="مسائل حرجة" value={summary.criticalCount} tone="critical" />
        </div>

        <Card title="الملخص التنفيذي" icon="📝">
          <p className="text-base leading-loose text-gray-700">{report.executiveSummary}</p>
        </Card>

        <Card title="نقاط القوة" icon="✓" accent="success">
          <ul className="space-y-2">
            {report.strengths.map((strength, index) => (
              <li key={index} className="flex items-start gap-3 rounded-lg bg-green-50/60 px-3 py-2.5">
                <span className="mt-0.5 text-green-600">✓</span>
                <span className="leading-relaxed text-gray-800">{strength}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="تغطية المعايير (١٤ معيارًا)" icon="📋">
          <CriteriaTable items={report.criteriaCoverage} />
        </Card>

        <Card title="مسائل حرجة" icon="🔴" accent="critical">
          {report.criticalIssues.length === 0 ? (
            <p className="rounded-lg bg-green-50 px-4 py-3 text-gray-700">لا توجد مسائل حرجة — عمل ممتاز.</p>
          ) : (
            <div className="space-y-4">
              {report.criticalIssues.map((issue, index) => (
                <SeverityCard key={index} variant="critical" data={issue} />
              ))}
            </div>
          )}
        </Card>

        <Card title="مسائل مهمة" icon="🟡" accent="important">
          {report.importantIssues.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-4 py-3 text-gray-600">لا توجد مسائل مهمة إضافية.</p>
          ) : (
            <div className="space-y-4">
              {report.importantIssues.map((issue, index) => (
                <SeverityCard key={index} variant="important" data={issue} />
              ))}
            </div>
          )}
        </Card>

        <Card title="أهم الخطوات قبل التسليم" icon="🎯">
          <ol className="space-y-3">
            {report.topPriorityActions.map((action, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-base font-medium leading-relaxed text-gray-800">{action}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="ملاحظات المراجعين الثلاثة" icon="🗒️">
          <details className="group">
            <summary className="cursor-pointer select-none text-sm font-semibold text-blue-700 hover:text-blue-800">
              عرض ملاحظات المراجعين
            </summary>
            <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
              <div className="rounded-lg border-r-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">مراجع المحتوى والدقة العلمية</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.contentAccuracy}</p>
              </div>
              <div className="rounded-lg border-r-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">مراجع الأدلة والمصادر</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.evidenceSources}</p>
              </div>
              <div className="rounded-lg border-r-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">مراجع الوضوح والبنية والنزاهة</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.clarityIntegrity}</p>
              </div>

              {reviewerNotes.disagreements && (
                <div className="rounded-lg border-r-4 border-amber-300 bg-amber-50 p-3">
                  <h3 className="mb-1 text-sm font-semibold text-amber-900">نقاط اختلاف بين المراجعين</h3>
                  <p className="text-sm leading-relaxed text-amber-800">{reviewerNotes.disagreements}</p>
                </div>
              )}
            </div>
          </details>
        </Card>

        <GuardrailStatusBadge />
      </div>
    </div>
  )
}

export default ReportPage
