import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeacher } from '../context/TeacherContext.jsx'

function TeacherLoginPage() {
  const navigate = useNavigate()
  const { setToken } = useTeacher()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!code.trim()) return

    setStatus('checking')
    setErrorMessage(null)

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/sync/ping`, {
        headers: { 'X-Sync-Token': code.trim() },
      })

      if (!response.ok) {
        setErrorMessage('Incorrect access code.')
        setStatus('idle')
        return
      }

      setToken(code.trim())
      navigate('/teacher')
    } catch {
      setErrorMessage('Could not connect to the server. Make sure the server is running.')
      setStatus('idle')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-center text-xl font-bold text-gray-900">Teacher Login</h1>

        <label className="mb-2 block text-sm font-medium text-gray-700">Access Code</label>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          autoFocus
        />

        {errorMessage && <p className="mb-4 text-sm text-red-600">{errorMessage}</p>}

        <button
          type="submit"
          disabled={!code.trim() || status === 'checking'}
          className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {status === 'checking' ? 'Checking...' : 'Log In'}
        </button>
      </form>
    </div>
  )
}

export default TeacherLoginPage
