import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import reviewRouter from './routes/review.js'
import { ltiRouter, ltiApiRouter } from './routes/lti.js'

const FRONTEND_DIST_DIR = path.join(import.meta.dirname, '..', '..', 'frontend', 'dist')

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/review', reviewRouter)
app.use('/lti', ltiRouter)
app.use('/api/lti', ltiApiRouter)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use(express.static(FRONTEND_DIST_DIR))
app.get(/^\/(?!api\/|lti\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'))
})

const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})
