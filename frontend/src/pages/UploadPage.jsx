import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReview } from '../context/ReviewContext.jsx'
import FileDropzone from '../components/FileDropzone.jsx'

function UploadPage() {
  const navigate = useNavigate()
  const { status, submitReview } = useReview()

  const [assignmentId, setAssignmentId] = useState('')
  const [studentFile, setStudentFile] = useState(null)

  const canSubmit = assignmentId.trim().length > 0 && studentFile !== null

  function handleSubmit() {
    if (!canSubmit) return

    const formData = new FormData()
    formData.append('assignmentId', assignmentId.trim())
    formData.append('studentFile', studentFile)

    submitReview(formData)
    navigate('/processing')
  }

  const isProcessing = status === 'processing'

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto max-w-[600px] rounded-lg bg-white p-6 shadow">
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          هذه الأداة تُستخدم مرة واحدة فقط لكل واجب، وهي مخصصة للمراجعة والتوجيه فقط — لا تعطي درجات ولا تكتب أي جزء من
          الواجب نيابة عنك.
        </div>

        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">مراجعة أولية للواجب قبل التسليم</h1>

        <div className="mb-6">
          <label htmlFor="assignmentId" className="mb-1 block text-sm font-medium text-gray-700">
            معرّف الواجب <span className="text-red-500">*</span>
          </label>
          <input
            id="assignmentId"
            type="text"
            value={assignmentId}
            onChange={(e) => setAssignmentId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">مؤقتًا يُدخل يدويًا حتى يتم الربط مع Moodle لاحقًا.</p>
        </div>

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
