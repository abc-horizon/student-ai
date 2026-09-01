import path from 'path'
import Database from 'better-sqlite3'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const db = new Database(path.join(DATA_DIR, 'sync.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS moodle_courses (
    course_id TEXT PRIMARY KEY,
    fullname TEXT,
    shortname TEXT,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS moodle_assignments (
    course_id TEXT,
    cmid TEXT,
    assign_id TEXT,
    name TEXT,
    intro TEXT,
    due_date TEXT,
    synced_at TEXT,
    PRIMARY KEY (course_id, cmid)
  );

  CREATE TABLE IF NOT EXISTS moodle_students (
    course_id TEXT,
    moodle_user_id TEXT,
    fullname TEXT,
    email TEXT,
    synced_at TEXT,
    PRIMARY KEY (course_id, moodle_user_id)
  );

  CREATE TABLE IF NOT EXISTS student_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    course_id TEXT,
    report_json TEXT NOT NULL,
    status TEXT NOT NULL,
    corrected_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (student_id, assignment_id)
  );
`)

// moodle_assignments existed before assign_id was added — CREATE TABLE IF NOT EXISTS won't
// retrofit the column onto an already-created table, so add it explicitly for older sync.db files.
try {
  db.exec('ALTER TABLE moodle_assignments ADD COLUMN assign_id TEXT')
} catch (err) {
  if (!/duplicate column name/i.test(err.message)) throw err
}

const upsertCourseStmt = db.prepare(`
  INSERT INTO moodle_courses (course_id, fullname, shortname, synced_at)
  VALUES (@courseId, @fullname, @shortname, @syncedAt)
  ON CONFLICT(course_id) DO UPDATE SET fullname = excluded.fullname, shortname = excluded.shortname, synced_at = excluded.synced_at
`)

const upsertAssignmentStmt = db.prepare(`
  INSERT INTO moodle_assignments (course_id, cmid, assign_id, name, intro, due_date, synced_at)
  VALUES (@courseId, @cmid, @assignId, @name, @intro, @dueDate, @syncedAt)
  ON CONFLICT(course_id, cmid) DO UPDATE SET
    assign_id = excluded.assign_id, name = excluded.name, intro = excluded.intro, due_date = excluded.due_date, synced_at = excluded.synced_at
`)

const upsertStudentStmt = db.prepare(`
  INSERT INTO moodle_students (course_id, moodle_user_id, fullname, email, synced_at)
  VALUES (@courseId, @moodleUserId, @fullname, @email, @syncedAt)
  ON CONFLICT(course_id, moodle_user_id) DO UPDATE SET
    fullname = excluded.fullname, email = excluded.email, synced_at = excluded.synced_at
`)

const deleteStudentsForCourseStmt = db.prepare('DELETE FROM moodle_students WHERE course_id = ?')

const getCourseStmt = db.prepare('SELECT * FROM moodle_courses WHERE course_id = ?')
const listAssignmentsStmt = db.prepare('SELECT * FROM moodle_assignments WHERE course_id = ? ORDER BY name')
const listStudentsStmt = db.prepare('SELECT * FROM moodle_students WHERE course_id = ? ORDER BY fullname')

const saveReviewStmt = db.prepare(`
  INSERT INTO student_reviews (student_id, assignment_id, course_id, report_json, status, corrected_by, created_at, updated_at)
  VALUES (@studentId, @assignmentId, @courseId, @reportJson, @status, @correctedBy, @now, @now)
  ON CONFLICT(student_id, assignment_id) DO UPDATE SET
    report_json = excluded.report_json,
    status = excluded.status,
    corrected_by = excluded.corrected_by,
    updated_at = excluded.updated_at
`)

const getReviewStmt = db.prepare('SELECT * FROM student_reviews WHERE student_id = ? AND assignment_id = ?')
const listReviewsForAssignmentStmt = db.prepare('SELECT * FROM student_reviews WHERE assignment_id = ? ORDER BY updated_at DESC')
const listReviewsForCourseStmt = db.prepare('SELECT * FROM student_reviews WHERE course_id = ? ORDER BY updated_at DESC')
const getReviewForCourseAndStudentStmt = db.prepare(
  'SELECT * FROM student_reviews WHERE course_id = ? AND student_id = ? ORDER BY updated_at DESC LIMIT 1',
)

function nowIso() {
  return new Date().toISOString()
}

export function upsertCourse({ courseId, fullname, shortname }) {
  upsertCourseStmt.run({ courseId: String(courseId), fullname: fullname || null, shortname: shortname || null, syncedAt: nowIso() })
}

export function upsertAssignment({ courseId, cmid, assignId, name, intro, dueDate }) {
  upsertAssignmentStmt.run({
    courseId: String(courseId),
    cmid: String(cmid),
    assignId: assignId != null ? String(assignId) : null,
    name: name || null,
    intro: intro || null,
    dueDate: dueDate || null,
    syncedAt: nowIso(),
  })
}

// A full sync replaces the enrolled-student list for this course wholesale, in one transaction:
// every existing row for courseId is deleted first, then the freshly-fetched roster is inserted.
// Without this, a student who is no longer returned by core_enrol_get_enrolled_users (unenrolled,
// or — as happened once — the whole fetch having come from the wrong Moodle instance) stays
// stuck in this table forever, since plain upserts only ever add/update and never remove.
const replaceStudentsForCourseTx = db.transaction((courseId, students, syncedAt) => {
  deleteStudentsForCourseStmt.run(courseId)
  for (const student of students) {
    upsertStudentStmt.run({
      courseId,
      moodleUserId: String(student.moodleUserId),
      fullname: student.fullname || null,
      email: student.email || null,
      syncedAt,
    })
  }
})

export function replaceStudentsForCourse(courseId, students) {
  replaceStudentsForCourseTx(String(courseId), students, nowIso())
}

export function getCourse(courseId) {
  return getCourseStmt.get(String(courseId))
}

export function listAssignments(courseId) {
  return listAssignmentsStmt.all(String(courseId))
}

export function listStudents(courseId) {
  return listStudentsStmt.all(String(courseId))
}

function rowToReview(row) {
  if (!row) return null
  return {
    studentId: row.student_id,
    assignmentId: row.assignment_id,
    courseId: row.course_id,
    report: JSON.parse(row.report_json),
    status: row.status,
    correctedBy: row.corrected_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function saveReview({ studentId, assignmentId, courseId, report, status, correctedBy }) {
  saveReviewStmt.run({
    studentId: String(studentId),
    assignmentId: String(assignmentId),
    courseId: courseId != null ? String(courseId) : null,
    reportJson: JSON.stringify(report),
    status,
    correctedBy: correctedBy || null,
    now: nowIso(),
  })
}

export function getReview({ studentId, assignmentId }) {
  return rowToReview(getReviewStmt.get(String(studentId), String(assignmentId)))
}

export function listReviewsForAssignment(assignmentId) {
  return listReviewsForAssignmentStmt.all(String(assignmentId)).map(rowToReview)
}

export function listReviewsForCourse(courseId) {
  return listReviewsForCourseStmt.all(String(courseId)).map(rowToReview)
}

export function getReviewForCourseAndStudent(courseId, studentId) {
  return rowToReview(getReviewForCourseAndStudentStmt.get(String(courseId), String(studentId)))
}
