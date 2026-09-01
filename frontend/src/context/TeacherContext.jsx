import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const TeacherContext = createContext(null)

const TOKEN_STORAGE_KEY = 'teacherSyncToken'

export function TeacherProvider({ children }) {
  const navigate = useNavigate()
  const [token, setTokenState] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY))

  const setToken = useCallback((value) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, value)
    setTokenState(value)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setTokenState(null)
    navigate('/teacher/login')
  }, [navigate])

  // Thin wrapper around fetch for /api/sync/* calls: attaches the shared access token, and on a
  // 401 (missing/wrong token) clears it and bounces to the login page rather than leaving the
  // caller to fail confusingly against every subsequent request.
  const teacherFetch = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          'X-Sync-Token': token || '',
        },
      })

      // 401 = no/expired token; 403 = wrong token (requireTeacher.js uses 403 for the latter) —
      // both mean the stored token is no longer valid, so both bounce back to login the same way.
      if (response.status === 401 || response.status === 403) {
        logout()
        throw new Error('Your session has expired, please log in again.')
      }

      return response
    },
    [token, logout],
  )

  const value = { token, setToken, logout, teacherFetch, isAuthenticated: Boolean(token) }

  return <TeacherContext.Provider value={value}>{children}</TeacherContext.Provider>
}

export function useTeacher() {
  const context = useContext(TeacherContext)
  if (!context) {
    throw new Error('useTeacher must be used within a TeacherProvider')
  }
  return context
}

export function RequireTeacherAuth({ children }) {
  const { isAuthenticated } = useTeacher()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated) navigate('/teacher/login', { replace: true })
  }, [isAuthenticated, navigate])

  if (!isAuthenticated) return null

  return children
}
