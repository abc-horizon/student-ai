import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getErrorMessage } from '../utils/errorMessages.js'

const ReviewContext = createContext(null)

const GENERIC_NETWORK_ERROR = 'Could not connect to the server. Make sure the server is running.'
const LAUNCH_TOKEN_STORAGE_KEY = 'ltiLaunchToken'

export function ReviewProvider({ children }) {
  const [status, setStatus] = useState('idle')
  const [report, setReport] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [searchParams] = useSearchParams()

  // Captured once per browser tab: if this page was ever opened with a launchToken (a real
  // LTI launch from Moodle), it must be attached to every /api/review submission from then on
  // — even after client-side navigation strips it from the URL (e.g. the "try again" button
  // on ProcessingPage does a plain navigate('/')), or a full page reload happens in the same
  // tab. sessionStorage survives both of those; the URL alone does not.
  const [launchToken] = useState(() => {
    const fromUrl = searchParams.get('launchToken')
    if (fromUrl) {
      sessionStorage.setItem(LAUNCH_TOKEN_STORAGE_KEY, fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem(LAUNCH_TOKEN_STORAGE_KEY)
  })

  // Display-only: the student's name, if Moodle shared it on this launch. It is fetched purely
  // for showing in the report header — it never travels with the /api/review submission, so it
  // can't reach the AI prompt or the usage log (both key off studentId only).
  const [studentName, setStudentName] = useState(null)

  useEffect(() => {
    if (!launchToken) return

    let cancelled = false
    fetch(`${import.meta.env.VITE_API_BASE_URL}/api/lti/session?token=${encodeURIComponent(launchToken)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.studentName) {
          setStudentName(body.studentName)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [launchToken])

  const submitReview = useCallback(async (formData) => {
    setStatus('processing')
    setErrorMessage(null)

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/review`, {
        method: 'POST',
        body: formData,
      })

      const body = await response.json()

      if (!response.ok) {
        setErrorMessage(getErrorMessage(body.errorCode))
        setStatus('error')
        return
      }

      setReport(body)
      setStatus('done')
    } catch {
      setErrorMessage(GENERIC_NETWORK_ERROR)
      setStatus('error')
    }
  }, [])

  const value = { status, report, errorMessage, submitReview, launchToken, studentName }

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}

export function useReview() {
  const context = useContext(ReviewContext)
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider')
  }
  return context
}
