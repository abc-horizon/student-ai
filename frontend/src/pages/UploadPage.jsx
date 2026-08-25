import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReview } from '../context/ReviewContext.jsx'
import FileDropzone from '../components/FileDropzone.jsx'

function UploadPage() {
  const navigate = useNavigate()
  const { status, submitReview, launchToken } = useReview()

  const [studentFile, setStudentFile] = useState(null)

  const canSubmit = studentFile !== null

  function handleSubmit() {
    if (!canSubmit) return

    const formData = new FormData()
    formData.append('studentFile', studentFile)
    formData.append('launchToken', launchToken)

    submitReview(formData)
    navigate('/processing')
  }

  const isProcessing = status === 'processing'

  if (!launchToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow">
          <div className="mb-3 text-4xl">⚠️</div>
          <p className="text-gray-700">
            يجب فتح هذه الأداة من خلال الواجب بموودل مباشرة. يرجى العودة إلى موودل وفتح الأداة من هناك.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto max-w-[600px] rounded-lg bg-white p-6 shadow">
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          هذه الأداة تُستخدم مرة واحدة فقط لكل واجب، وهي مخصصة للمراجعة والتوجيه فقط — لا تعطي درجات ولا تكتب أي جزء من
          الواجب نيابة عنك.
        </div>

        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">مراجعة أولية للواجب قبل التسليم</h1>

        <div className="mb-6">
          <FileDropzone
            label="ملف الواجب (مطلوب)"
            required
            accept=".docx,.pdf"
            onFileSelected={setStudentFile}
          />
        </div>

        <button
          type="button"
          disabled={!canSubmit || isProcessing}
          onClick={handleSubmit}
          className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isProcessing ? 'جاري المعالجة...' : 'بدء الفحص والتحليل'}
        </button>
      </div>
    </div>
  )
}

export default UploadPage
