import { spawn } from 'child_process'
import path from 'path'
import { SignJWT, importJWK } from 'jose'
import { getOrCreateToolKeys } from '../services/ltiKeyService.js'
import { hasStudentUsedAssignment, recordStudentUsage } from '../services/ltiUsageTrackingService.js'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const TEST_PORT = 4124
const BASE_URL = `http://localhost:${TEST_PORT}`

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}${detail ? ` (${detail})` : ''}`)
  } else {
    console.log(`FAIL: ${label}${detail ? ` (${detail})` : ''}`)
    failures++
  }
}

// === Part 1: unit-level checks on the JSON tracker itself ===

const runId = Date.now()
const studentA = `unit-test-student-a-${runId}`
const studentB = `unit-test-student-b-${runId}`
const assignmentX = `unit-test-assignment-x-${runId}`

check('fresh (student, assignment) pair is reported as not used', !hasStudentUsedAssignment(studentA, assignmentX))

recordStudentUsage(studentA, assignmentX)
check('after recording, the same pair is reported as used', hasStudentUsedAssignment(studentA, assignmentX))
check(
  'a different student on the same assignment is still unused',
  !hasStudentUsedAssignment(studentB, assignmentX),
)

// Concurrency: fire many synchronous recordStudentUsage calls "at once" (no awaits between
// them) for distinct students on the same assignment, then confirm none were lost/corrupted.
const concurrentStudents = Array.from({ length: 20 }, (_, i) => `unit-test-concurrent-${runId}-${i}`)
concurrentStudents.forEach((sid) => recordStudentUsage(sid, assignmentX))
const allRecorded = concurrentStudents.every((sid) => hasStudentUsedAssignment(sid, assignmentX))
check('20 "concurrent" writes for distinct students all persisted correctly', allRecorded)

// === Part 2: integration checks against the real server + real signed tokens ===

async function signLaunchToken({ studentId, assignmentId, studentName = 'Test Student' }) {
  const { privateJwk, kid } = await getOrCreateToolKeys()
  const privateKey = await importJWK(privateJwk, 'RS256')
  return new SignJWT({ assignmentId, studentId, studentName, purpose: 'lti-launch' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function fakeDocxBlob() {
  return new Blob(['this is not a real docx file, just testing the usage-limit gate'], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

async function submitReview({ launchToken }) {
  const formData = new FormData()
  if (launchToken) formData.append('launchToken', launchToken)
  formData.append('studentFile', fakeDocxBlob(), 'dummy.docx')

  const res = await fetch(`${BASE_URL}/api/review`, { method: 'POST', body: formData })
  const body = await res.json()
  return { status: res.status, body }
}

const server = spawn('node', ['src/server.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, PORT: String(TEST_PORT) },
})

let serverOutput = ''
server.stdout.on('data', (chunk) => (serverOutput += chunk.toString()))
server.stderr.on('data', (chunk) => process.stderr.write(chunk))

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (serverOutput.includes('Server listening')) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

try {
  check('server started', await waitForServer())

  // Case A: brand-new LTI identity, valid token -> must NOT be blocked by the usage gate.
  // (It will still fail later at file-extraction since the file is fake — that's expected
  // and proves the gate let it through rather than short-circuiting.)
  const freshStudent = `itest-fresh-student-${runId}`
  const freshAssignment = `itest-fresh-assignment-${runId}`
  const freshToken = await signLaunchToken({ studentId: freshStudent, assignmentId: freshAssignment })
  const caseA = await submitReview({ launchToken: freshToken })
  check(
    'Case A: first-time LTI student is NOT blocked by usage gate',
    caseA.status === 400 && caseA.body.errorCode === 'EXTRACTION_FAILED',
    `got status=${caseA.status} errorCode=${caseA.body.errorCode}`,
  )

  // Case B: pre-seed usage for a specific identity, then try again with a valid token for
  // that SAME identity -> must be blocked with USAGE_LIMIT_EXCEEDED, before file processing.
  const usedStudent = `itest-used-student-${runId}`
  const usedAssignment = `itest-used-assignment-${runId}`
  recordStudentUsage(usedStudent, usedAssignment)
  const usedToken = await signLaunchToken({ studentId: usedStudent, assignmentId: usedAssignment })
  const caseB = await submitReview({ launchToken: usedToken })
  check(
    'Case B: repeat use by the same LTI student+assignment is blocked',
    caseB.status === 403 && caseB.body.errorCode === 'USAGE_LIMIT_EXCEEDED',
    `got status=${caseB.status} errorCode=${caseB.body.errorCode}`,
  )

  // Case C: a garbage/invalid launch token must be rejected outright.
  const caseC = await submitReview({ launchToken: 'not-a-real-jwt-token' })
  check(
    'Case C: an invalid/tampered launchToken is rejected',
    caseC.status === 401 && caseC.body.errorCode === 'INVALID_LAUNCH_TOKEN',
    `got status=${caseC.status} errorCode=${caseC.body.errorCode}`,
  )

  // Case D: no launchToken at all must be rejected outright — there is no manual/testing
  // fallback anymore, since assignmentId is never accepted as client-supplied text.
  const caseD = await submitReview({})
  check(
    'Case D: a request with no launchToken at all is rejected',
    caseD.status === 401 && caseD.body.errorCode === 'INVALID_LAUNCH_TOKEN',
    `got status=${caseD.status} errorCode=${caseD.body.errorCode}`,
  )
} catch (err) {
  console.error('Test run threw an error:', err)
  failures++
} finally {
  await new Promise((resolve) => {
    server.once('exit', resolve)
    server.kill()
    setTimeout(resolve, 3000)
  })
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
} else {
  console.log('\nAll checks passed.')
}
process.exitCode = failures > 0 ? 1 : 0
