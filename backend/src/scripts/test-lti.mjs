import { spawn, execFileSync } from 'child_process'
import path from 'path'
import { SignJWT, importJWK } from 'jose'
import { getOrCreateToolKeys } from '../services/ltiKeyService.js'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const TEST_PORT = 4123
const BASE_URL = `http://localhost:${TEST_PORT}`

let failures = 0

function check(label, condition) {
  if (condition) {
    console.log(`PASS: ${label}`)
  } else {
    console.log(`FAIL: ${label}`)
    failures++
  }
}

// (a) getOrCreateToolKeys() returns the same kid on a second call.
// Run as two separate processes so this actually exercises the on-disk cache
// (lti-keys.json) rather than just in-memory identity within one process.
function printKidInChildProcess() {
  return execFileSync('node', [path.join('src', 'scripts', 'print-kid.mjs')], {
    cwd: BACKEND_DIR,
  }).toString()
}

const kid1 = printKidInChildProcess()
const kid2 = printKidInChildProcess()
check('getOrCreateToolKeys() returns the same kid across calls', kid1 === kid2 && kid1.length > 0)

// Start the server for the HTTP-level checks.
const server = spawn('node', ['src/server.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, PORT: String(TEST_PORT) },
})

let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
})

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (serverOutput.includes('Server listening')) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

try {
  const up = await waitForServer()
  check('server started', up)

  // (b) GET /lti/jwks returns a valid JWK Set.
  const jwksRes = await fetch(`${BASE_URL}/lti/jwks`)
  const jwksBody = await jwksRes.json()
  const key = jwksBody?.keys?.[0]
  check(
    'GET /lti/jwks returns a valid JWK Set',
    jwksRes.status === 200 &&
      Array.isArray(jwksBody.keys) &&
      jwksBody.keys.length === 1 &&
      key.kty === 'RSA' &&
      typeof key.n === 'string' &&
      typeof key.e === 'string' &&
      typeof key.kid === 'string' &&
      key.use === 'sig',
  )

  // (c) a self-signed fake launch token is accepted by GET /api/lti/session.
  const { privateJwk, kid } = await getOrCreateToolKeys()
  const privateKey = await importJWK(privateJwk, 'RS256')
  const fakeLaunchToken = await new SignJWT({
    assignmentId: 'lti:test-context:test-resource-link',
    studentName: 'Test Student',
    purpose: 'lti-launch',
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  const sessionRes = await fetch(`${BASE_URL}/api/lti/session?token=${encodeURIComponent(fakeLaunchToken)}`)
  const sessionBody = await sessionRes.json()
  check(
    'valid self-signed launch token is accepted by GET /api/lti/session',
    sessionRes.status === 200 &&
      sessionBody.assignmentId === 'lti:test-context:test-resource-link' &&
      sessionBody.studentName === 'Test Student',
  )

  // (d) an invalid token is rejected with 401.
  const invalidRes = await fetch(`${BASE_URL}/api/lti/session?token=not-a-real-token`)
  check('invalid token is rejected with 401', invalidRes.status === 401)
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
