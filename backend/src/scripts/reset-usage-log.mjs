// DEV-ONLY: empties backend/data/usage-log.json back to {} so the same (studentId,
// assignmentId) pair can be re-submitted while testing locally, without touching the
// one-use-per-assignment logic itself (ltiUsageTrackingService.js / review.js are untouched —
// this script only clears the log file that logic reads from).
//
// Usage: npm run reset-usage   (from backend/)

import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const USAGE_LOG_PATH = path.join(DATA_DIR, 'usage-log.json')

if (process.env.NODE_ENV === 'production') {
  console.error('❌ reset-usage-log.mjs is a DEVELOPMENT-ONLY tool.')
  console.error('   NODE_ENV=production is set — refusing to clear usage-log.json in production.')
  process.exit(1)
}

function readUsageLog() {
  if (!fs.existsSync(USAGE_LOG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(USAGE_LOG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

const existingLog = readUsageLog()
const deletedCount = Object.keys(existingLog).length

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(USAGE_LOG_PATH, JSON.stringify({}, null, 2))

console.log(`✅ تم تفريغ usage-log.json. عدد السجلات المحذوفة: ${deletedCount}`)
