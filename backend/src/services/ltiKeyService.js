import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { generateKeyPair, exportJWK } from 'jose'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const KEYS_PATH = path.join(DATA_DIR, 'lti-keys.json')

let cachedKeys = null

export async function getOrCreateToolKeys() {
  if (cachedKeys) {
    return cachedKeys
  }

  if (fs.existsSync(KEYS_PATH)) {
    cachedKeys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'))
    return cachedKeys
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })

  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  })

  const kid = uuidv4()

  const privateJwk = await exportJWK(privateKey)
  const publicJwk = await exportJWK(publicKey)

  privateJwk.kid = kid
  privateJwk.alg = 'RS256'

  publicJwk.kid = kid
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'

  cachedKeys = { privateJwk, publicJwk, kid }
  fs.writeFileSync(KEYS_PATH, JSON.stringify(cachedKeys, null, 2))

  return cachedKeys
}
