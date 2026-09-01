import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTeacher } from '../context/TeacherContext.jsx'
import { downloadViaTeacherFetch } from '../utils/downloadFile.js'

const STATUS_LABEL = {
  ai_generated: { label: 'AI Review', className: 'bg-blue-100 text-blue-800' },
  corrected: { label: 'Corrected', className: 'bg-green-100 text-green-800' },
}

function ReviewStatusBadge({ status }) {
  const info = STATUS_LABEL[status] || { label: 'No Review', className: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${info.className}`}>{info.label}</span>
}

const LEVEL_INFO = {
  PASS: { label: 'Pass', className: 'bg-green-100 text-green-800' },
  MERIT: { label: 'Merit', className: 'bg-blue-100 text-blue-800' },
  DISTINCTION: { label: 'Distinction', className: 'bg-purple-100 text-purple-800' },
}

function CriteriaPanel({ criteria, status }) {
  if (status === 'loading') {
    return <p className="text-sm text-gray-500">Loading criteria...</p>
  }
  if (status === 'not-found' || !criteria) {
    return <p className="text-sm text-gray-500">No saved criteria file exists for this course yet.</p>
  }

  const byLevel = { PASS: [], MERIT: [], DISTINCTION: [] }
  for (const item of criteria.criteria) {
    if (byLevel[item.level]) byLevel[item.level].push(item)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">{criteria.unit.title}</p>
        <p className="text-xs text-gray-500">
          {criteria.unit.qualification} — Unit {criteria.unit.number}
        </p>
      </div>

      {Object.entries(byLevel).map(
        ([level, items]) =>
          items.length > 0 && (
            <div key={level}>
              <span className={`mb-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${LEVEL_INFO[level].className}`}>
                {LEVEL_INFO[level].label}
              </span>
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item.criterion_code} className="rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-700">
                    <span className="font-semibold text-gray-900">{item.criterion_code}</span> — {item.criterion_text}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}

function TeacherCourseRosterPage() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const { teacherFetch } = useTeacher()

  const [roster, setRoster] = useState(null)
  const [filesByStudent, setFilesByStudent] = useState({})
  const [errorMessage, setErrorMessage] = useState(null)
  const [downloadingKey, setDownloadingKey] = useState(null)
  const [criteria, setCriteria] = useState(null)
  const [criteriaStatus, setCriteriaStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false

    teacherFetch(`/api/sync/courses/${encodeURIComponent(courseId)}/criteria`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) {
          setCriteriaStatus('not-found')
          return
        }
        if (!res.ok) throw new Error()
        setCriteria(await res.json())
        setCriteriaStatus('found')
      })
      .catch(() => {
        if (!cancelled) setCriteriaStatus('not-found')
      })

    return () => {
      cancelled = true
    }
  }, [courseId, teacherFetch])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [rosterRes, assignmentsRes] = await Promise.all([
          teacherFetch(`/api/sync/courses/${encodeURIComponent(courseId)}/roster`),
          teacherFetch(`/api/sync/courses/${encodeURIComponent(courseId)}/assignments`),
        ])
        if (!rosterRes.ok) throw new Error('Could not load the student list.')
        if (!assignmentsRes.ok) throw new Error('Could not load the assignments list.')

        const rosterData = await rosterRes.json()
        const assignments = await assignmentsRes.json()
        if (cancelled) return
        setRoster(rosterData)

        // Merge each assignment's submission files into a per-student file list, keyed by
        // Moodle user id (submissions API returns numbers, roster rows carry them as strings).
        const merged = {}
        for (const assignment of assignments.filter((a) => a.assign_id)) {
          const subRes = await teacherFetch(`/api/sync/assignments/${assignment.assign_id}/submissions`)
          if (!subRes.ok) continue
          const submissions = await subRes.json()
          for (const submission of submissions) {
            const key = String(submission.moodleUserId)
            if (!merged[key]) merged[key] = []
            for (const file of submission.files) {
              merged[key].push({ ...file, assignmentName: assignment.name })
            }
          }
        }
        if (!cancelled) setFilesByStudent(merged)
      } catch (err) {
        if (!cancelled) setErrorMessage(err.message)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [courseId, teacherFetch])

  async function handleDownload(file, studentId) {
    const key = `${studentId}:${file.fileurl}`
    setDownloadingKey(key)
    try {
      await downloadViaTeacherFetch(teacherFetch, file.fileurl, file.filename)
    } catch (err) {
      setErrorMessage(err.message)
    } finally {
      setDownloadingKey(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Students in Course {courseId}</h1>
          <Link to="/teacher" className="text-sm font-medium text-blue-700 hover:text-blue-800">
            ← Back to Dashboard
          </Link>
        </div>

        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

        <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
          <aside className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:order-2 lg:w-72 lg:shrink-0">
            <h2 className="mb-4 border-b border-gray-100 pb-3 text-sm font-bold text-gray-900">Core Unit Criteria</h2>
            <CriteriaPanel criteria={criteria} status={criteriaStatus} />
          </aside>

          <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm lg:order-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Email</th>
                <th className="px-4 py-3 text-left font-semibold">Review Status</th>
                <th className="px-4 py-3 text-left font-semibold">Assignment Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(roster || []).map((student) => {
                const files = filesByStudent[String(student.moodle_user_id)] || []
                return (
                  <tr key={student.moodle_user_id} className="transition-colors hover:bg-gray-50/70">
                    <td className="px-4 py-4 align-top">
                      <button
                        onClick={() => navigate(`/teacher/courses/${courseId}/students/${student.moodle_user_id}`)}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {student.fullname}
                      </button>
                    </td>
                    <td className="px-4 py-4 align-top text-gray-600">{student.email || '—'}</td>
                    <td className="px-4 py-4 align-top">
                      <ReviewStatusBadge status={student.reviewStatus} />
                    </td>
                    <td className="px-4 py-4 align-top">
                      {files.length === 0 ? (
                        <span className="text-gray-400">No file uploaded</span>
                      ) : (
                        <ul className="space-y-1">
                          {files.map((file) => {
                            const key = `${student.moodle_user_id}:${file.fileurl}`
                            return (
                              <li key={key}>
                                <button
                                  onClick={() => handleDownload(file, student.moodle_user_id)}
                                  disabled={downloadingKey === key}
                                  className="text-blue-700 hover:underline disabled:text-gray-400"
                                  title={file.assignmentName}
                                >
                                  {downloadingKey === key ? 'Downloading...' : `⬇ ${file.filename}`}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

            {roster && roster.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No students have been synced for this course yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TeacherCourseRosterPage
