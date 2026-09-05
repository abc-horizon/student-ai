import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import reviewRouter from './routes/review.js'
import { ltiRouter, ltiApiRouter } from './routes/lti.js'
import { syncRouter } from './routes/sync.js'
import { settingsRouter } from './routes/settings.js'

const FRONTEND_DIST_DIR = path.join(import.meta.dirname, '..', '..', 'frontend', 'dist')

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/review', reviewRouter)
app.use('/lti', ltiRouter)
app.use('/api/lti', ltiApiRouter)
app.use('/api/sync', syncRouter)
app.use('/api/settings', settingsRouter)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use(express.static(FRONTEND_DIST_DIR))
app.get(/^\/(?!api\/|lti\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'))
})

const PORT = process.env.PORT || 4000

// Why any of this exists: the server used to disappear with no diagnostic at all,
// and nodemon reported it as "clean exit - waiting for changes before restart",
// which reads like the app finished on purpose — it hadn't. A failed listen()
// emits an 'error' event on the server object, and with no listener attached the
// process simply runs out of work and ends with code 0. These handlers turn a
// silent vanish into a one-line explanation.
process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaughtException:', error)
  process.exitCode = 1
})

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason)
  process.exitCode = 1
})

process.on('exit', (code) => {
  console.log(`[exit] process exiting with code ${code}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[exit] received ${signal}`)
    process.exit(0)
  })
}

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})

// Most common cause by far: another copy of the server — or a stale one that has
// not released the socket yet after a restart — is already holding PORT.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[fatal] port ${PORT} is already in use — another server is running on it.`)
  } else {
    console.error('[fatal] server error:', error)
  }
  process.exitCode = 1
})
