import { Router } from 'express'
import { syncCourse } from '../services/moodleSyncService.js'
import { listAssignments, listStudents } from '../db/syncDb.js'
import { listAssignmentReviews, saveCorrectedReport } from '../services/reviewStorageService.js'

export const syncRouter = Router()

// There's no admin auth system in this project — this shared-secret header is the minimum bar
// given this router exposes the full student roster and triggers external Moodle calls, both
// materially more sensitive than the student-facing /api/review endpoint.
syncRouter.use((req, res, next) => {
  const configuredToken = process.env.SYNC_ADMIN_TOKEN
  if (!configuredToken) {
    return res.status(503).json({ error: 'SYNC_ADMIN_TOKEN is not configured on the server.' })
  }
  if (req.get('X-Sync-Token') !== configuredToken) {
    return res.status(401).json({ error: 'Invalid or missing X-Sync-Token header.' })
  }
  next()
})

syncRouter.post('/courses/:courseId', async (req, res) => {
  try {
    const result = await syncCourse(req.params.courseId)
    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

syncRouter.get('/courses/:courseId/assignments', (req, res) => {
  res.status(200).json(listAssignments(req.params.courseId))
})

syncRouter.get('/courses/:courseId/students', (req, res) => {
  res.status(200).json(listStudents(req.params.courseId))
})

syncRouter.get('/assignments/:assignmentId/reviews', (req, res) => {
  res.status(200).json(listAssignmentReviews(req.params.assignmentId))
})

syncRouter.put('/reviews/:studentId/:assignmentId', (req, res) => {
  const { report, correctedBy } = req.body || {}
  if (!report || typeof report !== 'object') {
    return res.status(400).json({ error: 'Request body must include a "report" object.' })
  }

  saveCorrectedReport({
    studentId: req.params.studentId,
    assignmentId: req.params.assignmentId,
    report,
    correctedBy: correctedBy || null,
  })
  res.status(200).json({ ok: true })
})
