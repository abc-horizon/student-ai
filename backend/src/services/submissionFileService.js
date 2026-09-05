import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const SUBMISSIONS_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'submissions')

const ALLOWED_EXTENSIONS = ['.pdf', '.docx']

// The on-disk name is a hash, never the student-supplied filename — so nothing a student
// controls can steer the write outside SUBMISSIONS_DIR.
function storageKey(studentId, assignmentId) {
  return crypto.createHash('sha256').update(`${studentId}:${assignmentId}`).digest('hex')
}

export function saveSubmissionFile({ studentId, assignmentId, originalname, buffer }) {
  const extension = path.extname(originalname || '').toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(extension)) return

  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true })

  const key = storageKey(studentId, assignmentId)
  // A resubmission of the other format would otherwise leave the stale file behind and
  // findSubmissionFile would keep returning it (.pdf is probed first).
  for (const ext of ALLOWED_EXTENSIONS) {
    fs.rmSync(path.join(SUBMISSIONS_DIR, `${key}${ext}`), { force: true })
  }

  fs.writeFileSync(path.join(SUBMISSIONS_DIR, `${key}${extension}`), buffer)
}

export function findSubmissionFile({ studentId, assignmentId }) {
  const key = storageKey(studentId, assignmentId)

  for (const extension of ALLOWED_EXTENSIONS) {
    const filePath = path.join(SUBMISSIONS_DIR, `${key}${extension}`)
    if (fs.existsSync(filePath)) {
      return { filePath, extension }
    }
  }

  return null
}
