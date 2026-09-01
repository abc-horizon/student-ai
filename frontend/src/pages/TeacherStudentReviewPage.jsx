import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTeacher } from '../context/TeacherContext.jsx'
import { downloadViaTeacherFetch } from '../utils/downloadFile.js'
import EditableReport from '../components/EditableReport.jsx'

function TeacherStudentReviewPage() {
  const { courseId, studentId } = useParams()
  const { teacherFetch } = useTeacher()

  const [loadState, setLoadState] = useState('loading') // loading | found | not-found | error
  const [errorMessage, setErrorMessage] = useState(null)
  const [assignmentId, setAssignmentId] = useState(null)
  const [report, setReport] = useState(null)
  const [files, setFiles] = useState([])
  const [correctedBy, setCorrectedBy] = useState('')
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const reviewRes = await teacherFetch(
          `/api/sync/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(studentId)}/review`,
        )
        if (reviewRes.status === 404) {
          if (!cancelled) setLoadState('not-found')
        } else if (reviewRes.ok) {
          const review = await reviewRes.json()
          if (!cancelled) {
            setAssignmentId(review.assignmentId)
            setReport(review.report)
            setLoadState('found')
          }
        } else {
          throw new Error("Could not load the student's review.")
        }

        const assignmentsRes = await teacherFetch(`/api/sync/courses/${encodeURIComponent(courseId)}/assignments`)
        if (assignmentsRes.ok) {
          const assignments = await assignmentsRes.json()
          const studentFiles = []
          for (const assignment of assignments.filter((a) => a.assign_id)) {
            const subRes = await teacherFetch(`/api/sync/assignments/${assignment.assign_id}/submissions`)
            if (!subRes.ok) continue
            const submissions = await subRes.json()
            const mine = submissions.find((s) => String(s.moodleUserId) === String(studentId))
            if (mine) {
              for (const file of mine.files) studentFiles.push({ ...file, assignmentName: assignment.name })
            }
          }
          if (!cancelled) setFiles(studentFiles)
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err.message)
          setLoadState('error')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [courseId, studentId, teacherFetch])

  async function handleDownload(file) {
    try {
      await downloadViaTeacherFetch(teacherFetch, file.fileurl, file.filename)
    } catch (err) {
      setErrorMessage(err.message)
    }
  }

  async function handleSave() {
    setSaveState('saving')
    setErrorMessage(null)
    try {
      const response = await teacherFetch(
        `/api/sync/reviews/${encodeURIComponent(studentId)}/${encodeURIComponent(assignmentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ report, correctedBy: correctedBy.trim() || null, courseId }),
        },
      )
      if (!response.ok) throw new Error('Failed to save the correction.')
      setSaveState('saved')
    } catch (err) {
      setErrorMessage(err.message)
      setSaveState('idle')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Student Review #{studentId}</h1>
          <Link to={`/teacher/courses/${courseId}`} className="text-sm font-medium text-blue-700 hover:text-blue-800">
            ← Back to Student List
          </Link>
        </div>

        {errorMessage && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</p>}

        {files.length > 0 && (
          <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-base font-bold text-gray-900">Submitted Assignment Files</h2>
            <p className="mb-3 text-xs text-gray-500">
              These are the actual files the student submitted on Moodle — review them directly for assignments the
              AI cannot assess (such as coding projects).
            </p>
            <ul className="space-y-1">
              {files.map((file, index) => (
                <li key={index}>
                  <button onClick={() => handleDownload(file)} className="text-blue-700 hover:underline" title={file.assignmentName}>
                    ⬇ {file.filename}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loadState === 'loading' && <p className="text-sm text-gray-500">Loading...</p>}

        {loadState === 'not-found' && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
            There is no AI review for this student in this course yet.
            {files.length > 0 && ' You can review the submitted assignment file above directly.'}
          </div>
        )}

        {loadState === 'found' && report && (
          <>
            <EditableReport report={report} onChange={setReport} />

            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <label className="mb-2 block text-sm font-medium text-gray-700">Corrected by (optional)</label>
              <input
                value={correctedBy}
                onChange={(e) => setCorrectedBy(e.target.value)}
                className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleSave}
                disabled={saveState === 'saving'}
                className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved ✓' : 'Save Correction'}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default TeacherStudentReviewPage
