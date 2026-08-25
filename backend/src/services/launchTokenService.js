import { importJWK, jwtVerify } from 'jose'
import { getOrCreateToolKeys } from './ltiKeyService.js'

export async function verifyLaunchToken(token) {
  const { publicJwk } = await getOrCreateToolKeys()
  const publicKey = await importJWK(publicJwk, 'RS256')
  const { payload } = await jwtVerify(token, publicKey)

  if (payload.purpose !== 'lti-launch') {
    throw new Error('Unexpected token purpose.')
  }

  return payload
}
