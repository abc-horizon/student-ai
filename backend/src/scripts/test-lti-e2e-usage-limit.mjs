import { spawn } from 'child_process'
import http from 'http'
import path from 'path'
import { URL } from 'url'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { recordStudentUsage } from '../services/ltiUsageTrackingService.js'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const APP_PORT = 4125
const FAKE_PLATFORM_PORT = 4126
const APP_BASE = `http://localhost:${APP_PORT}`
const FAKE_ISS = 'http://fake-moodle.test'
const FAKE_CLIENT_ID = 'fake-client-id'

let failures = 0
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}${detail ? ` (${detail})` : ''}`)
  if (!condition) failures++
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
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
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
const fakeKid = 'fake-platform-key-1'
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

async function signFakeIdToken({ sub, nonce, contextId, resourceLinkId, deploymentId = 'fake-deployment-1' }) {
  return new SignJWT({
    sub,
    name: 'E2E Test Student',
    nonce,
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': deploymentId,
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

// Runs a full /lti/login -> /lti/launch round trip against the REAL app server and returns
// the launchToken exactly as the frontend would receive it, plus the studentId/assignmentId
// it should correspond to (computed the same way lti.js computes them).
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

  return { launchToken, assignmentId: `lti:${contextId}:${resourceLinkId}` }
}

function fakeDocxBlob() {
  return new Blob(['not a real docx, just exercising the usage-limit gate'], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

async function submitReview({ launchToken }) {
  const formData = new FormData()
  if (launchToken) formData.append('launchToken', launchToken)
  formData.append('studentFile', fakeDocxBlob(), 'dummy.docx')
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

try {
  check('server started (pointed at fake Moodle platform)', await waitForServer())

  // === Scenario 1: brand-new student+assignment, real /lti/login -> /lti/launch chain,
  // then /api/review — must NOT be blocked (the gate should let it through). ===
  const freshSub = `e2e-fresh-student-${runId}`
  const freshContext = `e2e-fresh-context-${runId}`
  const freshResourceLink = `e2e-fresh-resource-${runId}`
  const fresh = await runRealLtiLaunch({ sub: freshSub, contextId: freshContext, resourceLinkId: freshResourceLink })

  const freshSubmit = await submitReview({ launchToken: fresh.launchToken })
  check(
    'Scenario 1: first-time LTI launch is NOT blocked (real /lti/login -> /lti/launch -> /api/review chain)',
    freshSubmit.status === 400 && freshSubmit.body.errorCode === 'EXTRACTION_FAILED',
    `status=${freshSubmit.status} errorCode=${freshSubmit.body.errorCode}`,
  )

  // === Scenario 2: pre-seed usage for a specific student+assignment (simulating "already
  // completed one real analysis"), then run a REAL /lti/login -> /lti/launch for that SAME
  // student+assignment, and submit /api/review TWICE with the same real launchToken. Both
  // must be blocked — there is no client-supplied assignmentId anymore to bypass this with. ===
  const usedSub = `e2e-used-student-${runId}`
  const usedContext = `e2e-used-context-${runId}`
  const usedResourceLink = `e2e-used-resource-${runId}`
  const usedAssignmentId = `lti:${usedContext}:${usedResourceLink}`
  recordStudentUsage(usedSub, usedAssignmentId)

  const used = await runRealLtiLaunch({ sub: usedSub, contextId: usedContext, resourceLinkId: usedResourceLink })

  const attempt1 = await submitReview({ launchToken: used.launchToken })
  check(
    'Scenario 2a: repeat student is blocked',
    attempt1.status === 403 && attempt1.body.errorCode === 'USAGE_LIMIT_EXCEEDED',
    `status=${attempt1.status} errorCode=${attempt1.body.errorCode}`,
  )

  const attempt2 = await submitReview({ launchToken: used.launchToken })
  check(
    'Scenario 2b: SAME student is STILL blocked on a second attempt',
    attempt2.status === 403 && attempt2.body.errorCode === 'USAGE_LIMIT_EXCEEDED',
    `status=${attempt2.status} errorCode=${attempt2.body.errorCode}`,
  )

  // === Scenario 3: no launchToken at all must be rejected outright — there is no manual
  // fallback anymore now that the assignmentId field has been removed from the UI. ===
  const noToken = await submitReview({})
  check(
    'Scenario 3: a request with no launchToken at all is rejected',
    noToken.status === 401 && noToken.body.errorCode === 'INVALID_LAUNCH_TOKEN',
    `status=${noToken.status} errorCode=${noToken.body.errorCode}`,
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
  fakePlatformServer.close()
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
} else {
  console.log('\nAll checks passed.')
}
process.exitCode = failures > 0 ? 1 : 0
