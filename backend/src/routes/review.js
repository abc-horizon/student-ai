// This route requires a real LTI launch — see backend/src/scripts/test-usage-limit.mjs and
// test-lti-e2e-usage-limit.mjs for how to exercise it with a validly-signed launchToken
// without needing a live Moodle instance.
// Note: also requires a real ANTHROPIC_API_KEY in backend/.env (not just .env.example) to
// succeed end-to-end.

import { Router } from 'express'
import multer from 'multer'
import { validateFile, validateFileCount } from '../services/fileValidation.js'
import { extractText } from '../services/textExtraction.js'
import { hasStudentUsedAssignment, recordStudentUsage } from '../services/ltiUsageTrackingService.js'
import { verifyLaunchToken } from '../services/launchTokenService.js'
import { reviewAssignment } from '../services/aiReviewService.js'
import { buildReport } from '../services/reportBuilder.js'
import { getAssignmentBrief } from '../services/moodleApiService.js'
import { saveGeneratedReport } from '../services/reviewStorageService.js'

const router = Router()

const upload = multer({ storage: multer.memoryStorage() })

const uploadFields = upload.fields([{ name: 'studentFile', maxCount: 1 }])

router.post('/', uploadFields, async (req, res) => {
  // The student's identity and which assignment this is are NEVER taken from client-supplied
  // text — only from this cryptographically-signed token, produced by our own /lti/launch
  // after verifying the real Moodle id_token. A request with no launch session at all can't
  // be tied to a real student+assignment, so it's rejected rather than falling back to some
  // shared/default identity (which would defeat the one-use-per-assignment guarantee).
  const launchToken = req.body?.launchToken
  if (!launchToken) {
    return res.status(401).json({ error: 'A valid LTI launch session is required.', errorCode: 'INVALID_LAUNCH_TOKEN' })
  }

  let studentId, assignmentId
  try {
    const payload = await verifyLaunchToken(launchToken)
    if (!payload.studentId || !payload.assignmentId) {
      throw new Error('Launch token is missing studentId/assignmentId.')
    }
    studentId = payload.studentId
    assignmentId = payload.assignmentId
  } catch {
    return res.status(401).json({ error: 'Invalid or expired LTI launch session.', errorCode: 'INVALID_LAUNCH_TOKEN' })
  }

  if (hasStudentUsedAssignment(studentId, assignmentId)) {
    return res.status(403).json({
      error: 'لقد استخدمت هذه الأداة من قبل لهذا الواجب.',
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

  // Best-effort: getAssignmentBrief() never throws — any failure (wrong Moodle instance, no
  // token configured, network/timeout, ambiguous assignment) resolves to null, and the review
  // proceeds with an empty brief exactly as it always has. See moodleApiService.js.
  const [, contextId, resourceLinkId] = /^lti:([^:]+):([^:]+)$/.exec(assignmentId) || []
  const assignmentBrief = contextId ? await getAssignmentBrief({ courseId: contextId, resourceLinkId }) : null

  let aiResult
  try {
    aiResult = await reviewAssignment({
      studentText: studentResult.text,
      briefText: assignmentBrief?.brief || '',
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

  recordStudentUsage(studentId, assignmentId)

  // Best-effort: a persistence failure must never break the response the student already
  // has in hand — it only makes the review unavailable for later sync/correction.
  try {
    saveGeneratedReport({ studentId, assignmentId, courseId: contextId || null, report })
  } catch (err) {
    console.warn(`[review] failed to persist generated report for ${studentId}/${assignmentId}: ${err.message}`)
  }

  res.status(200).json(report)
})

export default router
