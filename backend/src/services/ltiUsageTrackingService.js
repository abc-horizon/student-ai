import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const USAGE_LOG_PATH = path.join(DATA_DIR, 'usage-log.json')

function usageKey(studentId, assignmentId) {
  return `${studentId}::${assignmentId}`
}

function readUsageLog() {
  if (!fs.existsSync(USAGE_LOG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(USAGE_LOG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

// Write via a temp file + rename so a crash mid-write can never leave usage-log.json
// truncated or corrupted — rename is atomic on the same volume. On Windows, renaming onto
// an existing file can transiently fail with EPERM/EBUSY if something else (antivirus,
// search indexing, another near-simultaneous request) has it briefly open — a few quick
// retries clear that up without needing a real lock/mutex for what's meant to stay simple.
function writeUsageLog(log) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmpPath = `${USAGE_LOG_PATH}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  fs.writeFileSync(tmpPath, JSON.stringify(log, null, 2))

  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmpPath, USAGE_LOG_PATH)
      return
    } catch (err) {
      const retryable = err.code === 'EPERM' || err.code === 'EBUSY'
      if (!retryable || attempt === maxAttempts) {
        fs.rmSync(tmpPath, { force: true })
        throw err
      }
      const waitUntil = Date.now() + attempt * 15
      while (Date.now() < waitUntil) {
        // brief synchronous busy-wait — this whole function is intentionally synchronous
      }
    }
  }
}

export function hasStudentUsedAssignment(studentId, assignmentId) {
  const log = readUsageLog()
  return Boolean(log[usageKey(studentId, assignmentId)])
}

// Read-modify-write happens synchronously with no `await` in between, so within this
// single-threaded Node process no other request's handler can interleave mid-update.
export function recordStudentUsage(studentId, assignmentId) {
  const log = readUsageLog()
  log[usageKey(studentId, assignmentId)] = {
    studentId,
    assignmentId,
    timestamp: new Date().toISOString(),
  }
  writeUsageLog(log)
}
