import { getCourseInfo, listCourseAssignments, listEnrolledStudents } from './moodleApiService.js'
import { upsertCourse, upsertAssignment, upsertStudent } from '../db/syncDb.js'

// Pulls a course's assignments and student roster from Moodle and stores them locally.
// Each step is independent so a failure partway through (e.g. assignments succeed, roster
// fails) still leaves whatever succeeded persisted, and the caller sees exactly what happened.
export async function syncCourse(courseId) {
  const errors = []
  let assignmentsSynced = 0
  let studentsSynced = 0

  try {
    const courseInfo = await getCourseInfo(courseId)
    upsertCourse({ courseId, fullname: courseInfo.fullname, shortname: courseInfo.shortname })
  } catch (err) {
    errors.push(`course info: ${err.message}`)
  }

  try {
    const assignments = await listCourseAssignments(courseId)
    for (const assignment of assignments) {
      upsertAssignment({ courseId, ...assignment })
    }
    assignmentsSynced = assignments.length
  } catch (err) {
    errors.push(`assignments: ${err.message}`)
  }

  try {
    const students = await listEnrolledStudents(courseId)
    for (const student of students) {
      upsertStudent({ courseId, ...student })
    }
    studentsSynced = students.length
  } catch (err) {
    errors.push(`students: ${err.message}`)
  }

  return { courseId: String(courseId), assignmentsSynced, studentsSynced, errors }
}
