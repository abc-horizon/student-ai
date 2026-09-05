import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReview } from '../context/ReviewContext.jsx'
import CriteriaTable from '../components/CriteriaTable.jsx'
import SeverityCard from '../components/SeverityCard.jsx'
import GuardrailStatusBadge from '../components/GuardrailStatusBadge.jsx'
import FilePreview from '../components/FilePreview.jsx'
import CoverageBreakdown, { COVERAGE_SECTION_IDS } from '../components/CoverageBreakdown.jsx'
import ParagraphAnalysis from '../components/ParagraphAnalysis.jsx'

const STAT_TONE_CLASSES = {
  fullyCovered: { box: 'bg-green-50 ring-green-200', text: 'text-green-700' },
  partiallyCovered: { box: 'bg-amber-50 ring-amber-200', text: 'text-amber-700' },
  notCovered: { box: 'bg-gray-50 ring-gray-200', text: 'text-gray-700' },
  critical: { box: 'bg-red-50 ring-red-200', text: 'text-red-700' },
}

// Section ids the stat chips jump to. "Where You Stand" only renders a group when it has at
// least one entry, so a chip whose count is 0 falls back to that card's own id instead.
const COVERAGE_CARD_ID = 'report-coverage-breakdown'
const CRITICAL_ISSUES_CARD_ID = 'report-critical-issues'

const STAT_TARGET_IDS = {
  fullyCovered: [COVERAGE_SECTION_IDS.fullyCovered, COVERAGE_CARD_ID],
  partiallyCovered: [COVERAGE_SECTION_IDS.partiallyCovered, COVERAGE_CARD_ID],
  notCovered: [COVERAGE_SECTION_IDS.notCovered, COVERAGE_CARD_ID],
  critical: [CRITICAL_ISSUES_CARD_ID],
}

// Scrolls the reader to the section a stat chip represents and briefly flashes its border,
// instead of a popup repeating the same numbers in a modal.
function scrollToReportSection(targetIds) {
  const el = targetIds.map((id) => document.getElementById(id)).find(Boolean)
  if (!el) return

  el.scrollIntoView({ behavior: 'smooth', block: 'start' })

  el.classList.remove('report-highlight-flash')
  // Force a reflow so re-clicking the same chip restarts the animation instead of no-op'ing.
  void el.offsetWidth
  el.classList.add('report-highlight-flash')
  el.addEventListener('animationend', () => el.classList.remove('report-highlight-flash'), { once: true })
}

function StatChip({ label, value, tone }) {
  const { box, text } = STAT_TONE_CLASSES[tone]

  return (
    <button
      type="button"
      onClick={() => scrollToReportSection(STAT_TARGET_IDS[tone])}
      title="Click to jump to this number's details"
      className={`w-full cursor-pointer rounded-xl p-4 text-center ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${box}`}
    >
      <div className={`text-2xl font-bold ${text}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-600">{label}</div>
    </button>
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

function Card({ id, title, icon, accent = 'neutral', children }) {
  return (
    <section id={id} className={`scroll-mt-6 rounded-2xl border bg-white p-6 shadow-sm ${CARD_BORDER_CLASSES[accent]}`}>
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

// Suggested filename for the saved PDF. Browsers derive the default name of a
// "Save as PDF" print job from document.title, so the title is swapped to this
// for the duration of the print and restored afterwards.
function reportFileName() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `report-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function ReportPage() {
  const navigate = useNavigate()
  const { report, studentName, launchToken } = useReview()

  useEffect(() => {
    if (!report) {
      navigate('/')
    }
  }, [report, navigate])

  // Shared by every jump target in the report — the severity cards and the paragraph rows
  // both call requestJump, so the matching/highlighting logic lives in exactly one place
  // (FilePreview + utils/anchorMatch.js) rather than being reimplemented per section.
  const [previewMode, setPreviewMode] = useState('original')
  const [anchorRequest, setAnchorRequest] = useState(null)
  const [anchorNotice, setAnchorNotice] = useState(null)
  const noticeTimerRef = useRef(null)

  useEffect(() => () => clearTimeout(noticeTimerRef.current), [])

  const requestJump = useCallback((anchorText) => {
    if (!anchorText) return
    clearTimeout(noticeTimerRef.current)
    setAnchorNotice(null)
    // Switching to the searchable view is implicit: the student asked to be taken to a spot,
    // and only the extracted-text pane can scroll to one.
    setPreviewMode('interactive')
    // The nonce makes a repeat click on the same issue a new request rather than a no-op.
    setAnchorRequest({ text: anchorText, nonce: (anchorRequest?.nonce ?? 0) + 1 })
  }, [anchorRequest])

  const handleAnchorResolved = useCallback((found) => {
    if (found) return
    setAnchorNotice("We couldn't pinpoint the exact location within the assignment text.")
    clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setAnchorNotice(null), 5000)
  }, [])

  function handleSavePdf() {
    const originalTitle = document.title
    document.title = reportFileName()

    // The reviewer-notes card is a collapsed <details>. Collapsed content is not
    // laid out, so it would silently vanish from the PDF — open it for the print,
    // then put it back exactly as the student had it.
    const collapsed = Array.from(document.querySelectorAll('[data-print-report] details:not([open])'))
    for (const element of collapsed) {
      element.open = true
    }

    let restored = false
    function restore() {
      if (restored) return
      restored = true
      document.title = originalTitle
      for (const element of collapsed) {
        element.open = false
      }
      window.removeEventListener('afterprint', restore)
    }

    window.addEventListener('afterprint', restore)
    window.print()

    // Chrome/Edge fire afterprint once the dialog closes; Safari historically does
    // not. window.print() returning is the fallback signal — restore() is guarded
    // so whichever path runs first wins and the other becomes a no-op.
    restore()
  }

  // Plain in-app navigation, matching the "Try Again" button on
  // ProcessingPage. ReviewProvider sits above <Routes>, so a route change never
  // unmounts it and the launchToken it captured survives — including when the
  // token only ever came from the URL, since the provider mirrors it into
  // sessionStorage on first load. No usage state is touched here: the
  // once-per-assignment record lives server-side in usage-log.json, so coming
  // back to the upload page cannot hand the student another attempt.
  function handleCancel() {
    navigate('/')
  }

  if (!report) {
    return null
  }

  const { summary, reviewerNotes } = report

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10" data-print-page>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <h1 className="text-xl font-bold text-gray-900">
          {studentName ? `Review Report — ${studentName}` : 'Review Report'}
        </h1>

        {anchorNotice && (
          <div className="print-hidden rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            {anchorNotice}
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex flex-1 flex-col gap-6 lg:order-2 lg:max-w-[820px]" data-print-report>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatChip label="Fully Covered" value={summary.fullyCoveredCount} tone="fullyCovered" />
              <StatChip label="Partially Covered" value={summary.partiallyCoveredCount} tone="partiallyCovered" />
              <StatChip label="Not Covered" value={summary.notCoveredCount} tone="notCovered" />
              <StatChip label="Critical Issues" value={summary.criticalCount} tone="critical" />
            </div>

            <Card title="Executive Summary" icon="📝">
          <p className="text-base leading-loose text-gray-700">{report.executiveSummary}</p>
        </Card>

        <Card id={COVERAGE_CARD_ID} title="Where You Stand" icon="🧭">
          <CoverageBreakdown items={report.criteriaCoverage} />
        </Card>

        {/* Hidden rather than shown empty: a submission with no real content legitimately has
            no strengths, and an empty card reads as a rendering fault. */}
        {report.strengths.length > 0 && (
        <Card title="Strengths" icon="✓" accent="success">
          <ul className="space-y-2">
            {report.strengths.map((strength, index) => (
              <li key={index} className="flex items-start gap-3 rounded-lg bg-green-50/60 px-3 py-2.5">
                <span className="mt-0.5 text-green-600">✓</span>
                <span className="leading-relaxed text-gray-800">{strength}</span>
              </li>
            ))}
          </ul>
        </Card>
        )}

        {/* Optional: older reports and any run where the model omitted the field simply do
            not render this section, rather than showing an empty shell. */}
        {Array.isArray(report.paragraphAnalysis) && report.paragraphAnalysis.length > 0 && (
          <Card title="Paragraph Analysis" icon="🧩">
            <ParagraphAnalysis items={report.paragraphAnalysis} onJump={requestJump} />
          </Card>
        )}

        <Card title="Criteria Coverage (14 Criteria)" icon="📋">
          <CriteriaTable items={report.criteriaCoverage} />
        </Card>

        <Card id={CRITICAL_ISSUES_CARD_ID} title="Critical Issues" icon="🔴" accent="critical">
          {report.criticalIssues.length === 0 ? (
            <p className="rounded-lg bg-green-50 px-4 py-3 text-gray-700">No critical issues — excellent work.</p>
          ) : (
            <div className="space-y-4">
              {report.criticalIssues.map((issue, index) => (
                <SeverityCard key={index} variant="critical" data={issue} onJump={requestJump} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Important Issues" icon="🟡" accent="important">
          {report.importantIssues.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-4 py-3 text-gray-600">No additional important issues.</p>
          ) : (
            <div className="space-y-4">
              {report.importantIssues.map((issue, index) => (
                <SeverityCard key={index} variant="important" data={issue} onJump={requestJump} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Top Priority Actions Before Submission" icon="🎯">
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

        <Card title="Notes from the Three Reviewers" icon="🗒️">
          <details className="group">
            <summary className="cursor-pointer select-none text-sm font-semibold text-blue-700 hover:text-blue-800">
              Show reviewer notes
            </summary>
            <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
              <div className="rounded-lg border-l-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Content & Scientific Accuracy Reviewer</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.contentAccuracy}</p>
              </div>
              <div className="rounded-lg border-l-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Evidence & Sources Reviewer</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.evidenceSources}</p>
              </div>
              <div className="rounded-lg border-l-4 border-blue-200 bg-blue-50/50 p-3">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Clarity, Structure & Integrity Reviewer</h3>
                <p className="text-sm leading-relaxed text-gray-600">{reviewerNotes.clarityIntegrity}</p>
              </div>

              {reviewerNotes.disagreements && (
                <div className="rounded-lg border-l-4 border-amber-300 bg-amber-50 p-3">
                  <h3 className="mb-1 text-sm font-semibold text-amber-900">Points of Disagreement Between Reviewers</h3>
                  <p className="text-sm leading-relaxed text-amber-800">{reviewerNotes.disagreements}</p>
                </div>
              )}
            </div>
          </details>
        </Card>

            <GuardrailStatusBadge />

            <div className="print-hidden flex flex-col gap-3 pt-2 sm:flex-row sm:justify-start">
              <button
                type="button"
                onClick={handleSavePdf}
                className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:min-w-[160px]"
              >
                Save PDF
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 sm:min-w-[160px]"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="print-hidden h-[80vh] w-full lg:order-1 lg:sticky lg:top-10 lg:h-[calc(100vh-5rem)] lg:flex-1">
            <FilePreview
              launchToken={launchToken}
              mode={previewMode}
              onModeChange={setPreviewMode}
              anchorRequest={anchorRequest}
              onAnchorResolved={handleAnchorResolved}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReportPage
