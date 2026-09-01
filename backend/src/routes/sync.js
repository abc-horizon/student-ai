import { Router } from 'express'
import { requireTeacher } from '../middleware/requireTeacher.js'
import { syncCourse } from '../services/moodleSyncService.js'
import { getCourse, listAssignments, listStudents } from '../db/syncDb.js'
import { getCriteriaForCourseName } from '../services/criteriaService.js'
import {
  listAssignmentReviews,
  listCourseReviews,
  getCourseStudentReview,
  getStudentReview,
  saveCorrectedReport,
} from '../services/reviewStorageService.js'
import { listSubmissions, downloadFile } from '../services/moodleApiService.js'

export const syncRouter = Router()

// There's no admin auth system in this project — this shared-secret header is the minimum bar
// given this router exposes the full student roster and triggers external Moodle calls, both
// materially more sensitive than the student-facing /api/review endpoint. See
// middleware/requireTeacher.js — also used by /api/settings.
syncRouter.use(requireTeacher)

syncRouter.get('/ping', (req, res) => {
  res.status(200).json({ ok: true })
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

// Real BTEC criteria (P/M/D), matched off the synced course's name — see criteriaService.js for
// why this is a static per-unit file lookup instead of a live Moodle call.
syncRouter.get('/courses/:courseId/criteria', (req, res) => {
  const course = getCourse(req.params.courseId)
  if (!course) return res.status(404).json({ error: 'Course has not been synced yet.' })

  const rubric = getCriteriaForCourseName(course.fullname)
  if (!rubric) return res.status(404).json({ error: 'No criteria file found for this course/unit yet.' })

  res.status(200).json(rubric)
})

syncRouter.get('/assignments/:assignmentId/reviews', (req, res) => {
  res.status(200).json(listAssignmentReviews(req.params.assignmentId))
})

// Reviews are keyed by our own LTI-derived assignmentId (see saveGeneratedReport in review.js),
// which can't be reliably mapped back to one specific synced Moodle assignment — course_id is
// the one field both a review and a synced roster/assignment agree on. See the plan notes on
// this join in the sync feature's design doc.
syncRouter.get('/courses/:courseId/roster', (req, res) => {
  const students = listStudents(req.params.courseId)
  const reviewsByStudentId = new Map(listCourseReviews(req.params.courseId).map((r) => [r.studentId, r]))

  res.status(200).json(
    students.map((student) => {
      const review = reviewsByStudentId.get(student.moodle_user_id)
      return {
        ...student,
        reviewStatus: review?.status || null,
        assignmentId: review?.assignmentId || null,
      }
    }),
  )
})

syncRouter.get('/courses/:courseId/students/:studentId/review', (req, res) => {
  const review = getCourseStudentReview(req.params.courseId, req.params.studentId)
  if (!review) return res.status(404).json({ error: 'No review found for this student in this course.' })
  res.status(200).json(review)
})

syncRouter.get('/assignments/:assignId/submissions', async (req, res) => {
  try {
    const submissions = await listSubmissions(req.params.assignId)
    res.status(200).json(submissions)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

syncRouter.get('/files/download', async (req, res) => {
  const { fileUrl, filename } = req.query
  if (!fileUrl || typeof fileUrl !== 'string') {
    return res.status(400).json({ error: 'Query param "fileUrl" is required.' })
  }

  try {
    const upstream = await downloadFile(fileUrl)
    res.setHeader('Content-Disposition', `attachment; filename="${(filename || 'submission').replace(/"/g, '')}"`)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.status(200).send(buffer)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

syncRouter.put('/reviews/:studentId/:assignmentId', (req, res) => {
  const { report, correctedBy, courseId } = req.body || {}
  if (!report || typeof report !== 'object') {
    return res.status(400).json({ error: 'Request body must include a "report" object.' })
  }

  // A correction updates the same (studentId, assignmentId) row a generated report was saved
  // under — inherit its course_id so the course-level roster/review join above keeps working,
  // unless the caller explicitly supplies one (e.g. seeding a review that doesn't exist yet).
  const existing = getStudentReview({ studentId: req.params.studentId, assignmentId: req.params.assignmentId })

  saveCorrectedReport({
    studentId: req.params.studentId,
    assignmentId: req.params.assignmentId,
    courseId: courseId ?? existing?.courseId ?? null,
    report,
    correctedBy: correctedBy || null,
  })
  res.status(200).json({ ok: true })
})
