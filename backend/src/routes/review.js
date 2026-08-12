// Example test (PowerShell):
// curl.exe -X POST http://localhost:4000/api/review `
//   -F "assignmentId=test-assignment-001" `
//   -F "studentFile=@C:\path\to\sample.docx"
// Note: requires a real ANTHROPIC_API_KEY in backend/.env (not just .env.example) to succeed end-to-end.

import { Router } from 'express'
import multer from 'multer'
import { validateFile, validateFileCount } from '../services/fileValidation.js'
import { extractText } from '../services/textExtraction.js'
import { hasBeenUsed, logUsage } from '../services/usageLimitService.js'
import { reviewAssignment } from '../services/aiReviewService.js'
import { buildReport } from '../services/reportBuilder.js'

const router = Router()

const upload = multer({ storage: multer.memoryStorage() })

const uploadFields = upload.fields([{ name: 'studentFile', maxCount: 1 }])

router.post('/', uploadFields, async (req, res) => {
  const assignmentId = req.body?.assignmentId
  if (!assignmentId || !assignmentId.trim()) {
    return res.status(400).json({ error: 'assignmentId is required.', errorCode: 'ASSIGNMENT_ID_REQUIRED' })
  }

  if (hasBeenUsed(assignmentId)) {
    return res.status(403).json({
      error: 'This tool has already been used on this assignment. It can only be used once per assignment.',
      errorCode: 'USAGE_LIMIT_EXCEEDED',
    })
  }

  const files = req.files || {}

  const countCheck = validateFileCount(files)
  if (!countCheck.valid) {
    return res.status(400).json({ error: countCheck.reason, errorCode: countCheck.reasonCode })
  }

  const studentFile = files.studentFile[0]
  const studentFileCheck = validateFile(studentFile)
  if (!studentFileCheck.valid) {
    return res.status(400).json({ error: studentFileCheck.reason, errorCode: studentFileCheck.reasonCode })
  }

  const studentResult = await extractText(studentFile)
  if (studentResult.warning) {
    return res.status(400).json({ error: studentResult.warning, errorCode: studentResult.warningCode })
  }

  let aiResult
  try {
    aiResult = await reviewAssignment({
      studentText: studentResult.text,
      briefText: '',
      rubricText: '',
    })
  } catch (err) {
    return res.status(500).json({ error: err.message, errorCode: 'AI_SERVICE_ERROR' })
  }

  const { valid, report, reason } = buildReport(aiResult)
  if (!valid) {
    console.error('AI response failed report validation:', reason, aiResult)
    return res
      .status(500)
      .json({ error: 'The AI response did not pass validation: ' + reason, errorCode: 'REPORT_VALIDATION_FAILED' })
  }

  logUsage(assignmentId)

  res.status(200).json(report)
})

export default router
