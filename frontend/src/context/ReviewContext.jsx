import { createContext, useContext, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getArabicErrorMessage } from '../utils/errorMessages.js'

const ReviewContext = createContext(null)

const GENERIC_NETWORK_ERROR = 'تعذّر الاتصال بالخادم. تأكد أن الخادم يعمل.'
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
        setErrorMessage(getArabicErrorMessage(body.errorCode))
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

  const value = { status, report, errorMessage, submitReview, launchToken }

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}

export function useReview() {
  const context = useContext(ReviewContext)
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider')
  }
  return context
}
