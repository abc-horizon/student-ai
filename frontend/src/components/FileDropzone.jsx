import { useRef, useState } from 'react'

const DEFAULT_MAX_SIZE_BYTES = 15 * 1024 * 1024

function getExtension(filename) {
  const match = /\.[^.]+$/.exec(filename || '')
  return match ? match[0].toLowerCase() : ''
}

function FileDropzone({ label, required = false, accept, maxSizeBytes = DEFAULT_MAX_SIZE_BYTES, onFileSelected }) {
  const inputRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [error, setError] = useState(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const acceptedExtensions = accept.split(',').map((ext) => ext.trim().toLowerCase())

  function handleFile(file) {
    if (!file) return

    const extension = getExtension(file.name)
    if (!acceptedExtensions.includes(extension)) {
      setError(`صيغة الملف غير مدعومة. الصيغ المقبولة: ${accept.replace(/,/g, '، ')}`)
      return
    }

    if (file.size > maxSizeBytes) {
      setError('حجم الملف يتجاوز الحد الأقصى المسموح (15 ميجابايت).')
      return
    }

    setError(null)
    setSelectedFile(file)
    onFileSelected(file)
  }

  function handleInputChange(event) {
    handleFile(event.target.files?.[0] || null)
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragActive(false)
    handleFile(event.dataTransfer.files?.[0] || null)
  }

  function handleDragOver(event) {
    event.preventDefault()
    setIsDragActive(true)
  }

  function handleDragLeave() {
    setIsDragActive(false)
  }

  function handleRemove(event) {
    event.stopPropagation()
    setSelectedFile(null)
    setError(null)
    onFileSelected(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex items-center gap-2 text-sm text-gray-800">
            <span className="font-medium">{selectedFile.name}</span>
            <button
              type="button"
              onClick={handleRemove}
              className="text-red-500 underline hover:text-red-700"
            >
              إزالة
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            اسحب الملف وأفلته هنا، أو اضغط للاختيار من جهازك ({accept})
          </p>
        )}
      </div>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

export default FileDropzone
