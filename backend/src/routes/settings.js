import { Router } from 'express'
import { requireTeacher } from '../middleware/requireTeacher.js'
import {
  getAiConfig,
  saveAiConfig,
  resetAiConfig,
  addAvailableModel,
  removeAvailableModel,
} from '../services/aiConfigService.js'
import { getSystemPrompt } from '../prompts/systemPrompt.js'
import { testModelConnection } from '../services/aiReviewService.js'

export const settingsRouter = Router()

settingsRouter.use(requireTeacher)

function withCurrentPrompt(config) {
  return { ...config, currentPrompt: getSystemPrompt() }
}

settingsRouter.get('/', (req, res) => {
  res.status(200).json(withCurrentPrompt(getAiConfig()))
})

settingsRouter.put('/', (req, res) => {
  try {
    res.status(200).json(withCurrentPrompt(saveAiConfig(req.body || {})))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

settingsRouter.post('/reset', (req, res) => {
  res.status(200).json(withCurrentPrompt(resetAiConfig()))
})

settingsRouter.post('/models', (req, res) => {
  try {
    res.status(200).json(withCurrentPrompt(addAvailableModel(req.body?.model)))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

settingsRouter.delete('/models/:model', (req, res) => {
  try {
    res.status(200).json(withCurrentPrompt(removeAvailableModel(req.params.model)))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Fires one minimal, real request at the named model so the teacher can confirm it actually
// works before adopting it — see testModelConnection() for why this also reports back the
// model the API says it used (DeepSeek's endpoint can silently substitute an unrecognized name).
settingsRouter.post('/models/:model/test', async (req, res) => {
  const result = await testModelConnection(req.params.model)
  res.status(200).json(result)
})
