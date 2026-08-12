import { createContext, useContext, useState, useCallback } from 'react'
import { getArabicErrorMessage } from '../utils/errorMessages.js'

const ReviewContext = createContext(null)

const GENERIC_NETWORK_ERROR = 'تعذّر الاتصال بالخادم. تأكد أن الخادم يعمل.'

export function ReviewProvider({ children }) {
  const [status, setStatus] = useState('idle')
  const [report, setReport] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)

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

  const value = { status, report, errorMessage, submitReview }

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}

export function useReview() {
  const context = useContext(ReviewContext)
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider')
  }
  return context
}
