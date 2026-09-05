import {
  saveReview,
  getReview,
  listReviewsForAssignment,
  listReviewsForCourse,
  getReviewForCourseAndStudent,
} from '../db/syncDb.js'

// This is permanent storage, not a cache: it writes the ENTIRE report JSON — executiveSummary,
// strengths, criteriaCoverage, criticalIssues/importantIssues (including their verbatim
// anchorText quotes from the student's own submitted text), topPriorityActions, reviewerNotes —
// into the student_reviews table in backend/data/sync.db, kept indefinitely with no expiry or
// cleanup. It exists so the teacher roster/review pages (GET /api/sync/courses/:id/roster,
// GET /api/sync/courses/:id/students/:studentId/review) can read it back later. The student-
// facing report page's "Active Tool Safeguards" notice reflects exactly this — see
// GuardrailStatusBadge.jsx — so don't let this call silently start doing more (e.g. also
// persisting the raw student text) without updating that notice to match.
export function saveGeneratedReport({ studentId, assignmentId, courseId, report }) {
  saveReview({ studentId, assignmentId, courseId, report, status: 'ai_generated', correctedBy: null })
}

export function saveCorrectedReport({ studentId, assignmentId, courseId, report, correctedBy }) {
  saveReview({ studentId, assignmentId, courseId, report, status: 'corrected', correctedBy })
}

export function getStudentReview({ studentId, assignmentId }) {
  return getReview({ studentId, assignmentId })
}

export function listAssignmentReviews(assignmentId) {
  return listReviewsForAssignment(assignmentId)
}

export function listCourseReviews(courseId) {
  return listReviewsForCourse(courseId)
}

export function getCourseStudentReview(courseId, studentId) {
  return getReviewForCourseAndStudent(courseId, studentId)
}
