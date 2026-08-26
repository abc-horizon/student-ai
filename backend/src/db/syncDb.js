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

const upsertCourseStmt = db.prepare(`
  INSERT INTO moodle_courses (course_id, fullname, shortname, synced_at)
  VALUES (@courseId, @fullname, @shortname, @syncedAt)
  ON CONFLICT(course_id) DO UPDATE SET fullname = excluded.fullname, shortname = excluded.shortname, synced_at = excluded.synced_at
`)

const upsertAssignmentStmt = db.prepare(`
  INSERT INTO moodle_assignments (course_id, cmid, name, intro, due_date, synced_at)
  VALUES (@courseId, @cmid, @name, @intro, @dueDate, @syncedAt)
  ON CONFLICT(course_id, cmid) DO UPDATE SET
    name = excluded.name, intro = excluded.intro, due_date = excluded.due_date, synced_at = excluded.synced_at
`)

const upsertStudentStmt = db.prepare(`
  INSERT INTO moodle_students (course_id, moodle_user_id, fullname, email, synced_at)
  VALUES (@courseId, @moodleUserId, @fullname, @email, @syncedAt)
  ON CONFLICT(course_id, moodle_user_id) DO UPDATE SET
    fullname = excluded.fullname, email = excluded.email, synced_at = excluded.synced_at
`)

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

function nowIso() {
  return new Date().toISOString()
}

export function upsertCourse({ courseId, fullname, shortname }) {
  upsertCourseStmt.run({ courseId: String(courseId), fullname: fullname || null, shortname: shortname || null, syncedAt: nowIso() })
}

export function upsertAssignment({ courseId, cmid, name, intro, dueDate }) {
  upsertAssignmentStmt.run({
    courseId: String(courseId),
    cmid: String(cmid),
    name: name || null,
    intro: intro || null,
    dueDate: dueDate || null,
    syncedAt: nowIso(),
  })
}

export function upsertStudent({ courseId, moodleUserId, fullname, email }) {
  upsertStudentStmt.run({
    courseId: String(courseId),
    moodleUserId: String(moodleUserId),
    fullname: fullname || null,
    email: email || null,
    syncedAt: nowIso(),
  })
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
