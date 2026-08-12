import { getOrCreateToolKeys } from '../services/ltiKeyService.js'

const { kid } = await getOrCreateToolKeys()
process.stdout.write(kid)
