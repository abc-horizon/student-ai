import { saveReview, getReview, listReviewsForAssignment } from '../db/syncDb.js'

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
