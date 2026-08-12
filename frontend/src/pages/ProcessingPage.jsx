import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReview } from '../context/ReviewContext.jsx'

const STATUS_MESSAGES = ['جاري فحص الملف...', 'جاري استخراج النص...', 'جاري التحليل الأكاديمي...', 'جاري إعداد التقرير...']

function ProcessingPage() {
  const navigate = useNavigate()
  const { status, errorMessage } = useReview()
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (status === 'idle') {
      navigate('/')
    } else if (status === 'done') {
      navigate('/report')
    }
  }, [status, navigate])

  useEffect(() => {
    if (status !== 'processing') return undefined

    const interval = setInterval(() => {
      setMessageIndex((current) => (current + 1) % STATUS_MESSAGES.length)
    }, 2500)

    return () => clearInterval(interval)
  }, [status])

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow">
          <div className="mb-3 text-4xl">⚠️</div>
          <p className="mb-6 text-red-600">{errorMessage}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            المحاولة من جديد
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow">
        <div
          className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"
          role="status"
        />
        <p className="text-gray-700">{STATUS_MESSAGES[messageIndex]}</p>
      </div>
    </div>
  )
}

export default ProcessingPage
