import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'usage.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_log (
    assignment_id TEXT PRIMARY KEY,
    used_at TEXT NOT NULL
  )
`)

const hasBeenUsedStmt = db.prepare('SELECT 1 FROM usage_log WHERE assignment_id = ?')
const logUsageStmt = db.prepare('INSERT OR IGNORE INTO usage_log (assignment_id, used_at) VALUES (?, ?)')

export function hasBeenUsed(assignmentId) {
  return hasBeenUsedStmt.get(assignmentId) !== undefined
}

export function logUsage(assignmentId) {
  logUsageStmt.run(assignmentId, new Date().toISOString())
}
