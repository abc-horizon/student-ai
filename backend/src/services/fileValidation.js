import path from 'path'

function getExtension(filename) {
  return path.extname(filename || '').toLowerCase()
}

export function validateFile(file, { allowedTypes = ['.docx', '.pdf'], maxSizeBytes = 15 * 1024 * 1024 } = {}) {
  if (!file) {
    return { valid: false, reason: 'No file was provided.', reasonCode: 'FILE_MISSING' }
  }

  const extension = getExtension(file.originalname)
  if (!allowedTypes.includes(extension)) {
    return {
      valid: false,
      reason: 'Unsupported file type. Only .docx and .pdf files are allowed.',
      reasonCode: 'UNSUPPORTED_FILE_TYPE',
    }
  }

  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      reason: 'File exceeds the maximum allowed size of 15MB.',
      reasonCode: 'FILE_TOO_LARGE',
    }
  }

  if (!file.buffer || file.buffer.length === 0) {
    return {
      valid: false,
      reason: 'The file appears to be corrupted or unreadable.',
      reasonCode: 'FILE_CORRUPTED',
    }
  }

  return { valid: true }
}

export function validateFileCount(files) {
  const studentFile = files?.studentFile
  if (!studentFile || studentFile.length !== 1) {
    return {
      valid: false,
      reason: 'Exactly one student file must be provided.',
      reasonCode: 'FILE_COUNT_INVALID',
    }
  }

  return { valid: true }
}
