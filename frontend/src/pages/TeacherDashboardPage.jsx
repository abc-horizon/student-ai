import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeacher } from '../context/TeacherContext.jsx'

function TeacherDashboardPage() {
  const navigate = useNavigate()
  const { teacherFetch, logout } = useTeacher()

  const [courseId, setCourseId] = useState('')
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [syncSummary, setSyncSummary] = useState(null)

  async function loadAssignments(id) {
    const response = await teacherFetch(`/api/sync/courses/${encodeURIComponent(id)}/assignments`)
    if (!response.ok) throw new Error('Could not load the assignments list.')
    setAssignments(await response.json())
  }

  async function handleSync() {
    if (!courseId.trim()) return
    setStatus('syncing')
    setErrorMessage(null)
    setSyncSummary(null)

    try {
      const response = await teacherFetch(`/api/sync/courses/${encodeURIComponent(courseId.trim())}`, {
        method: 'POST',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Sync failed.')

      setSyncSummary(body)
      await loadAssignments(courseId.trim())
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('idle')
    }
  }

  async function handleLoadExisting() {
    if (!courseId.trim()) return
    setStatus('loading')
    setErrorMessage(null)

    try {
      await loadAssignments(courseId.trim())
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('idle')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Teacher Dashboard</h1>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/settings')} className="text-sm text-gray-500 hover:text-gray-700">
              AI Settings
            </button>
            <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">
              Log Out
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-gray-700">Moodle Course ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              placeholder="e.g. 513"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleLoadExisting}
              disabled={!courseId.trim() || status !== 'idle'}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View
            </button>
            <button
              onClick={handleSync}
              disabled={!courseId.trim() || status !== 'idle'}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {status === 'syncing' ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {errorMessage && <p className="mt-3 text-sm text-red-600">{errorMessage}</p>}
          {syncSummary && (
            <p className="mt-3 text-sm text-green-700">
              Sync complete: {syncSummary.assignmentsSynced} assignment(s), {syncSummary.studentsSynced} student(s).
              {syncSummary.errors?.length > 0 && ` (Warnings: ${syncSummary.errors.join(' | ')})`}
            </p>
          )}
        </div>

        {assignments && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-4">
              <h2 className="text-lg font-bold text-gray-900">Assignments</h2>
              <button
                onClick={() => navigate(`/teacher/courses/${encodeURIComponent(courseId.trim())}`)}
                className="text-sm font-medium text-blue-700 hover:text-blue-800"
              >
                View student list →
              </button>
            </div>

            {assignments.length === 0 ? (
              <p className="text-sm text-gray-500">No assignments have been synced for this course yet.</p>
            ) : (
              <ul className="space-y-2">
                {assignments.map((a) => (
                  <li key={a.cmid} className="rounded-lg bg-gray-50 px-4 py-3 text-sm">
                    <span className="font-medium text-gray-900">{a.name}</span>
                    {a.due_date && <span className="ms-2 text-gray-500">— Due: {new Date(a.due_date).toLocaleDateString('en-GB')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TeacherDashboardPage
