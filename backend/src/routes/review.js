// This route requires a real LTI launch — see backend/src/scripts/test-usage-limit.mjs and
// test-lti-e2e-usage-limit.mjs for how to exercise it with a validly-signed launchToken
// without needing a live Moodle instance.
// Note: also requires a real ANTHROPIC_API_KEY in backend/.env (not just .env.example) to
// succeed end-to-end.

import { Router } from 'express'
import fs from 'fs/promises'
import multer from 'multer'
import mammoth from 'mammoth'
import { validateFile, validateFileCount } from '../services/fileValidation.js'
import { extractText } from '../services/textExtraction.js'
import { hasStudentUsedAssignment, recordStudentUsage } from '../services/ltiUsageTrackingService.js'
import { verifyLaunchToken } from '../services/launchTokenService.js'
import { reviewAssignment } from '../services/aiReviewService.js'
import { getAiConfig } from '../services/aiConfigService.js'
import { buildReport } from '../services/reportBuilder.js'
import { getAssignmentBrief } from '../services/moodleApiService.js'
import { saveGeneratedReport } from '../services/reviewStorageService.js'
import { saveSubmissionFile, findSubmissionFile } from '../services/submissionFileService.js'

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

  // Kept as the original bytes, before extractText() reduces it to plain text, so the report
  // page can show the student the very document they uploaded.
  try {
    saveSubmissionFile({
      studentId,
      assignmentId,
      originalname: studentFile.originalname,
      buffer: studentFile.buffer,
    })
  } catch (err) {
    console.warn(`[review] failed to store submission file for ${studentId}/${assignmentId}: ${err.message}`)
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
    // A custom prompt override or additional instructions (set via the Settings page) can be
    // the actual cause of a failure here — see AiConfigError in aiReviewService.js. Give the
    // teacher a distinct, actionable errorCode instead of the generic AI-service message.
    if (err.code === 'AI_CONFIG_INVALID') {
      return res.status(500).json({ error: err.message, errorCode: 'AI_CONFIG_INVALID' })
    }
    return res.status(500).json({ error: err.message, errorCode: 'AI_SERVICE_ERROR' })
  }

  const { valid, report, reason } = buildReport(aiResult)
  if (!valid) {
    console.error('AI response failed report validation:', reason, aiResult)
    const config = getAiConfig()
    if (config.promptOverride || config.additionalInstructions) {
      return res.status(500).json({
        error:
          'The current custom AI settings (prompt override or additional instructions) are producing invalid reports: ' +
          reason +
          '. An administrator should review or restore defaults in Settings.',
        errorCode: 'AI_CONFIG_INVALID',
      })
    }
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

// Serves back the student's own uploaded document, unmodified, for the report page's preview
// pane. The launch token is the authorization: it decides whose file is read, so a student can
// only ever reach their own submission — no id is accepted from the query string.
router.get('/submission', async (req, res) => {
  let studentId, assignmentId
  try {
    const payload = await verifyLaunchToken(req.query.launchToken)
    studentId = payload.studentId
    assignmentId = payload.assignmentId
  } catch {
    return res.status(401).json({ error: 'Invalid or expired LTI launch session.', errorCode: 'INVALID_LAUNCH_TOKEN' })
  }

  const stored = findSubmissionFile({ studentId, assignmentId })
  if (!stored) {
    return res.status(404).json({ error: 'No stored submission for this assignment.', errorCode: 'SUBMISSION_NOT_FOUND' })
  }

  // nosniff on both branches: it stops a .pdf whose bytes happen to start with markup from
  // being re-sniffed as HTML and executed on our origin.
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (stored.extension === '.pdf') {
    res.type('application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    return res.sendFile(stored.filePath)
  }

  // No browser renders .docx natively, so it is converted to HTML on the way out — the stored
  // file itself stays the untouched original. This CSP is what makes it safe to serve document-
  // derived markup from our own origin: `default-src 'none'` blocks every script, and `sandbox`
  // drops the frame into an opaque origin. Doing it here rather than with an iframe sandbox
  // attribute keeps the restriction off the PDF branch, whose viewer won't run sandboxed.
  const { value: html } = await mammoth.convertToHtml({ path: stored.filePath })
  res.type('html')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox allow-popups",
  )
  res.send(
    `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">` +
      `<style>body{margin:0;padding:2rem;font-family:system-ui,sans-serif;line-height:1.8;color:#1f2937}` +
      `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:.4rem}</style>` +
      `<body>${html}</body></html>`,
  )
})

// The plain-text form of the same submission, for the report page's "عرض تفاعلي" pane. The
// HTML preview above is faithful to the original layout but is served into a sandboxed frame,
// so the parent page cannot search inside it or scroll it to a phrase. Returning the extracted
// text lets the report highlight an issue's anchorText in place.
//
// Deliberately re-extracted from the stored file rather than cached at review time: the text
// is derived data, extraction is cheap and local, and this keeps the review response and the
// persisted report exactly as they were. Authorization is the launch token, same as above —
// no id is accepted from the query string.
router.get('/submission-text', async (req, res) => {
  let studentId, assignmentId
  try {
    const payload = await verifyLaunchToken(req.query.launchToken)
    studentId = payload.studentId
    assignmentId = payload.assignmentId
  } catch {
    return res.status(401).json({ error: 'Invalid or expired LTI launch session.', errorCode: 'INVALID_LAUNCH_TOKEN' })
  }

  const stored = findSubmissionFile({ studentId, assignmentId })
  if (!stored) {
    return res.status(404).json({ error: 'No stored submission for this assignment.', errorCode: 'SUBMISSION_NOT_FOUND' })
  }

  let extraction
  try {
    const buffer = await fs.readFile(stored.filePath)
    extraction = await extractText({ originalname: `submission${stored.extension}`, buffer })
  } catch (err) {
    console.warn(`[review] submission-text extraction failed for ${studentId}/${assignmentId}: ${err.message}`)
    return res.status(500).json({ error: 'Failed to read the stored submission.', errorCode: 'EXTRACTION_FAILED' })
  }

  if (!extraction.text) {
    return res.status(422).json({ error: extraction.warning, errorCode: extraction.warningCode })
  }

  res.json({ text: extraction.text })
})

export default router
