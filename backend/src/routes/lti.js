import { Router } from 'express'
import crypto from 'crypto'
import path from 'path'
import Database from 'better-sqlite3'
import { importJWK, SignJWT, jwtVerify, createRemoteJWKSet } from 'jose'
import { getOrCreateToolKeys } from '../services/ltiKeyService.js'
import { verifyLaunchToken } from '../services/launchTokenService.js'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const db = new Database(path.join(DATA_DIR, 'lti-state.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS lti_login_state (
    state TEXT PRIMARY KEY,
    nonce TEXT,
    login_hint TEXT,
    lti_message_hint TEXT,
    created_at TEXT
  )
`)

const insertStateStmt = db.prepare(
  'INSERT INTO lti_login_state (state, nonce, login_hint, lti_message_hint, created_at) VALUES (?, ?, ?, ?, ?)',
)
const getStateStmt = db.prepare('SELECT * FROM lti_login_state WHERE state = ?')
const deleteStateStmt = db.prepare('DELETE FROM lti_login_state WHERE state = ?')

const LTI_CLAIM_DEPLOYMENT_ID = 'https://purl.imsglobal.org/spec/lti/claim/deployment_id'
const LTI_CLAIM_CONTEXT = 'https://purl.imsglobal.org/spec/lti/claim/context'
const LTI_CLAIM_RESOURCE_LINK = 'https://purl.imsglobal.org/spec/lti/claim/resource_link'

export const ltiRouter = Router()
export const ltiApiRouter = Router()

ltiRouter.get('/jwks', async (req, res) => {
  const { publicJwk } = await getOrCreateToolKeys()
  res.json({ keys: [publicJwk] })
})

function handleLogin(req, res) {
  const { iss, login_hint, lti_message_hint } = { ...req.query, ...req.body }

  if (iss !== process.env.LTI_PLATFORM_ISSUER) {
    return res.status(400).type('text/plain').send('Invalid issuer.')
  }

  const state = crypto.randomBytes(32).toString('hex')
  const nonce = crypto.randomBytes(32).toString('hex')

  insertStateStmt.run(state, nonce, login_hint || null, lti_message_hint || null, new Date().toISOString())

  const redirectUri = `${process.env.LTI_TOOL_BASE_URL}/lti/launch`

  const params = new URLSearchParams({
    scope: 'openid',
    response_type: 'id_token',
    client_id: process.env.LTI_PLATFORM_CLIENT_ID,
    redirect_uri: redirectUri,
    login_hint: login_hint || '',
    state,
    response_mode: 'form_post',
    nonce,
    prompt: 'none',
  })
  if (lti_message_hint) {
    params.set('lti_message_hint', lti_message_hint)
  }

  res.redirect(302, `${process.env.LTI_PLATFORM_AUTH_LOGIN_URL}?${params.toString()}`)
}

ltiRouter.get('/login', handleLogin)
ltiRouter.post('/login', handleLogin)

ltiRouter.post('/launch', async (req, res) => {
  const { id_token, state } = req.body

  const stored = getStateStmt.get(state)
  if (!stored) {
    return res.status(400).type('text/plain').send('Invalid or expired launch state.')
  }
  deleteStateStmt.run(state)

  let payload
  try {
    const platformJwks = createRemoteJWKSet(new URL(process.env.LTI_PLATFORM_KEYSET_URL))
    const result = await jwtVerify(id_token, platformJwks, {
      issuer: process.env.LTI_PLATFORM_ISSUER,
      audience: process.env.LTI_PLATFORM_CLIENT_ID,
    })
    payload = result.payload
  } catch (err) {
    return res.status(400).type('text/plain').send('Failed to verify id_token: ' + err.message)
  }

  if (payload.nonce !== stored.nonce) {
    return res.status(400).type('text/plain').send('Nonce mismatch.')
  }

  const studentName =
    payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || 'Unknown Student'

  // "sub" is the OIDC/LTI subject claim — a stable, unique identifier for this student on
  // this platform. It's REQUIRED by the LTI 1.3 spec, unlike name/email which may be withheld.
  const studentId = payload.sub
  if (!studentId) {
    return res.status(400).type('text/plain').send('The id_token is missing the required "sub" claim.')
  }

  const deploymentId = payload[LTI_CLAIM_DEPLOYMENT_ID]
  const contextId = payload[LTI_CLAIM_CONTEXT]?.id
  const resourceLinkId = payload[LTI_CLAIM_RESOURCE_LINK]?.id
  void deploymentId

  const assignmentId = `lti:${contextId}:${resourceLinkId}`

  const { privateJwk, kid } = await getOrCreateToolKeys()
  const privateKey = await importJWK(privateJwk, 'RS256')

  const launchToken = await new SignJWT({ assignmentId, studentId, studentName, purpose: 'lti-launch' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  res.redirect(302, `${process.env.LTI_TOOL_BASE_URL}/?launchToken=${encodeURIComponent(launchToken)}`)
})

ltiApiRouter.get('/session', async (req, res) => {
  const { token } = req.query

  if (!token) {
    return res.status(401).json({ error: 'Invalid or expired launch session.' })
  }

  try {
    const payload = await verifyLaunchToken(token)
    res.json({ assignmentId: payload.assignmentId, studentId: payload.studentId, studentName: payload.studentName })
  } catch {
    res.status(401).json({ error: 'Invalid or expired launch session.' })
  }
})
