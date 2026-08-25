// Comprehensive real-LTI-launch matrix test for the once-per-(student,assignment) usage gate.
//
// Simulates 4 sequential scenarios, each via a REAL /lti/login -> /lti/launch round trip
// against the actual app server (backed by a locally-hosted fake Moodle platform, so no real
// Moodle instance is needed):
//
//   1. Student A + Assignment 1 (first time)      -> must SUCCEED
//   2. Student A + Assignment 1 (again)           -> must be BLOCKED
//   3. Student A + Assignment 2 (different)       -> must SUCCEED
//   4. Student B + Assignment 1 (different)       -> must SUCCEED
//
// Scenarios expected to succeed use a real, extractable .docx (borrowed from mammoth's own
// test fixtures) so they go through an actual AI review call and produce a genuine report —
// not just "passed the gate then failed at extraction". This proves recordStudentUsage()
// really fires on success, and that each distinct (studentId, assignmentId) pair is tracked
// independently.

import 'dotenv/config'
import { spawn } from 'child_process'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const APP_PORT = 4131
const FAKE_PLATFORM_PORT = 4132
const APP_BASE = `http://localhost:${APP_PORT}`
const FAKE_ISS = 'http://fake-moodle-matrix-test.test'
const FAKE_CLIENT_ID = 'fake-client-id-matrix-test'
const REAL_DOCX_PATH = path.join(BACKEND_DIR, 'node_modules', 'mammoth', 'test', 'test-data', 'tables.docx')

const results = []
function record(scenario, expectation, pass, detail) {
  results.push({ scenario, expectation, pass, detail })
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${scenario}: ${expectation}${detail ? ` (${detail})` : ''}`)
}

// --- Raw HTTP helpers that do NOT follow redirects, so we can read Location headers ---
function rawGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject)
  })
}

function rawPostForm(url, formBody) {
  const data = new URLSearchParams(formBody).toString()
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      },
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// --- Fake Moodle platform: serves its own JWKS so /lti/launch can verify id_tokens we sign ---
const fakePlatformKeys = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
const fakeKid = 'fake-platform-key-matrix-test'
const fakePublicJwk = await exportJWK(fakePlatformKeys.publicKey)
fakePublicJwk.kid = fakeKid
fakePublicJwk.alg = 'RS256'
fakePublicJwk.use = 'sig'

const fakePlatformServer = http.createServer((req, res) => {
  if (req.url === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: [fakePublicJwk] }))
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => fakePlatformServer.listen(FAKE_PLATFORM_PORT, resolve))

async function signFakeIdToken({ sub, nonce, contextId, resourceLinkId }) {
  return new SignJWT({
    sub,
    name: 'Matrix Test Student',
    nonce,
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': 'fake-deployment-1',
    'https://purl.imsglobal.org/spec/lti/claim/context': { id: contextId },
    'https://purl.imsglobal.org/spec/lti/claim/resource_link': { id: resourceLinkId },
  })
    .setProtectedHeader({ alg: 'RS256', kid: fakeKid })
    .setIssuedAt()
    .setIssuer(FAKE_ISS)
    .setAudience(FAKE_CLIENT_ID)
    .setExpirationTime('5m')
    .sign(fakePlatformKeys.privateKey)
}

// A REAL /lti/login -> /lti/launch round trip against the actual app server — exactly what
// happens when a student clicks the tool link inside a Moodle assignment.
async function runRealLtiLaunch({ sub, contextId, resourceLinkId }) {
  const loginRes = await rawGet(`${APP_BASE}/lti/login?iss=${encodeURIComponent(FAKE_ISS)}&login_hint=${sub}`)
  if (loginRes.status !== 302) throw new Error(`/lti/login did not redirect (status ${loginRes.status}): ${loginRes.body}`)
  const loginRedirect = new URL(loginRes.headers.location)
  const state = loginRedirect.searchParams.get('state')
  const nonce = loginRedirect.searchParams.get('nonce')
  if (!state || !nonce) throw new Error('Could not extract state/nonce from /lti/login redirect.')

  const idToken = await signFakeIdToken({ sub, nonce, contextId, resourceLinkId })
  const launchRes = await rawPostForm(`${APP_BASE}/lti/launch`, { id_token: idToken, state })
  if (launchRes.status !== 302) throw new Error(`/lti/launch did not redirect (status ${launchRes.status}): ${launchRes.body}`)
  const launchRedirect = new URL(launchRes.headers.location)
  const launchToken = launchRedirect.searchParams.get('launchToken')
  if (!launchToken) throw new Error('Could not extract launchToken from /lti/launch redirect.')
  return launchToken
}

const realDocxBuffer = fs.readFileSync(REAL_DOCX_PATH)

async function submitReview(launchToken) {
  const formData = new FormData()
  formData.append('launchToken', launchToken)
  formData.append(
    'studentFile',
    new Blob([realDocxBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    'assignment.docx',
  )
  const res = await fetch(`${APP_BASE}/api/review`, { method: 'POST', body: formData })
  const body = await res.json()
  return { status: res.status, body }
}

// --- Spawn the real app server, pointed at our fake platform ---
const server = spawn('node', ['src/server.js'], {
  cwd: BACKEND_DIR,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    LTI_TOOL_BASE_URL: APP_BASE,
    LTI_PLATFORM_ISSUER: FAKE_ISS,
    LTI_PLATFORM_CLIENT_ID: FAKE_CLIENT_ID,
    LTI_PLATFORM_AUTH_LOGIN_URL: `${APP_BASE}/unused-auth-endpoint`,
    LTI_PLATFORM_KEYSET_URL: `http://localhost:${FAKE_PLATFORM_PORT}/jwks`,
  },
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

const runId = Date.now()
const studentA = `matrix-student-A-${runId}`
const studentB = `matrix-student-B-${runId}`
const courseContext = `matrix-course-${runId}`
const assignment1ResourceLink = `matrix-assignment-1-${runId}`
const assignment2ResourceLink = `matrix-assignment-2-${runId}`

try {
  const up = await waitForServer()
  record('setup', 'server started, pointed at fake Moodle platform', up)
  if (!up) throw new Error('Server did not start.')

  console.log(`\n(using a real .docx fixture: ${REAL_DOCX_PATH})`)
  console.log('This calls the real AI backend for each "must succeed" scenario — may take a while.\n')

  // === Scenario 1: Student A + Assignment 1, first time -> must SUCCEED ===
  const s1Token = await runRealLtiLaunch({ sub: studentA, contextId: courseContext, resourceLinkId: assignment1ResourceLink })
  const s1 = await submitReview(s1Token)
  record(
    '1) Student A + Assignment 1 (first time)',
    'must SUCCEED',
    s1.status === 200 && Array.isArray(s1.body.criteriaCoverage),
    `status=${s1.status}${s1.status !== 200 ? ` errorCode=${s1.body.errorCode}` : ' — real report generated'}`,
  )

  // === Scenario 2: Student A + Assignment 1, again (fresh launch, same identity) -> BLOCKED ===
  const s2Token = await runRealLtiLaunch({ sub: studentA, contextId: courseContext, resourceLinkId: assignment1ResourceLink })
  const s2 = await submitReview(s2Token)
  record(
    '2) Student A + Assignment 1 (second time)',
    'must be BLOCKED',
    s2.status === 403 && s2.body.errorCode === 'USAGE_LIMIT_EXCEEDED',
    `status=${s2.status} errorCode=${s2.body.errorCode}`,
  )

  // === Scenario 3: Student A + Assignment 2 (different assignment) -> must SUCCEED ===
  const s3Token = await runRealLtiLaunch({ sub: studentA, contextId: courseContext, resourceLinkId: assignment2ResourceLink })
  const s3 = await submitReview(s3Token)
  record(
    '3) Student A + Assignment 2 (different assignment)',
    'must SUCCEED',
    s3.status === 200 && Array.isArray(s3.body.criteriaCoverage),
    `status=${s3.status}${s3.status !== 200 ? ` errorCode=${s3.body.errorCode}` : ' — real report generated'}`,
  )

  // === Scenario 4: Student B + Assignment 1 (different student) -> must SUCCEED ===
  const s4Token = await runRealLtiLaunch({ sub: studentB, contextId: courseContext, resourceLinkId: assignment1ResourceLink })
  const s4 = await submitReview(s4Token)
  record(
    '4) Student B + Assignment 1 (different student)',
    'must SUCCEED',
    s4.status === 200 && Array.isArray(s4.body.criteriaCoverage),
    `status=${s4.status}${s4.status !== 200 ? ` errorCode=${s4.body.errorCode}` : ' — real report generated'}`,
  )
} catch (err) {
  console.error('Test run threw an error:', err)
  results.push({ scenario: 'unexpected error', expectation: '-', pass: false, detail: err.message })
} finally {
  await new Promise((resolve) => {
    server.once('exit', resolve)
    server.kill()
    setTimeout(resolve, 3000)
  })
  fakePlatformServer.close()
}

console.log('\n=== RESULT MATRIX ===')
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.scenario} — ${r.expectation}${r.detail ? ` (${r.detail})` : ''}`)
}

const failures = results.filter((r) => !r.pass).length
console.log(failures > 0 ? `\n${failures} scenario(s) failed.` : '\nAll 4 scenarios behaved exactly as required.')
process.exitCode = failures > 0 ? 1 : 0
