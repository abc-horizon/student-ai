import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'ai-config.json')

export const DEFAULT_CONFIG = {
  temperature: 0,
  model: 'deepseek-v4-flash',
  maxTokens: 8192,
  enableTokenLimit: true,
  additionalInstructions: '',
  promptOverride: null,
  availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
}

const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 1
const MIN_MAX_TOKENS = 1000
const MAX_MAX_TOKENS = 8000

const ALLOWED_UPDATE_KEYS = [
  'temperature',
  'model',
  'maxTokens',
  'enableTokenLimit',
  'additionalInstructions',
  'promptOverride',
]

// Same temp-file-then-rename pattern as ltiUsageTrackingService.js's usage-log.json: a crash
// mid-write can never leave ai-config.json truncated, and renaming onto an existing file is
// atomic on the same volume. See that file for why the retry loop exists on Windows.
function writeConfigFile(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmpPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2))

  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmpPath, CONFIG_PATH)
      return
    } catch (err) {
      const retryable = err.code === 'EPERM' || err.code === 'EBUSY'
      if (!retryable || attempt === maxAttempts) {
        fs.rmSync(tmpPath, { force: true })
        throw err
      }
      const waitUntil = Date.now() + attempt * 15
      while (Date.now() < waitUntil) {
        // brief synchronous busy-wait — same tradeoff as ltiUsageTrackingService.js
      }
    }
  }
}

// A missing or corrupt file must never take the tool down — fall back to defaults silently and
// let the next successful PUT /api/settings (or POST /api/settings/reset) recreate it.
function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch (err) {
    console.warn(`[aiConfigService] ai-config.json is missing or invalid (${err.message}) — using defaults.`)
    return { ...DEFAULT_CONFIG }
  }
}

// Deliberately re-read from disk on every call, not cached in memory, so a change made through
// /api/settings takes effect on the very next AI request with no server restart.
export function getAiConfig() {
  const config = readConfigFile()

  if (!Array.isArray(config.availableModels) || config.availableModels.length === 0) {
    config.availableModels = [...DEFAULT_CONFIG.availableModels]
  }

  // The active model can go stale if the file is hand-edited and the model removed from the
  // list — fall back rather than sending an unvalidated name to the AI provider.
  if (!config.availableModels.includes(config.model)) {
    console.warn(`[aiConfigService] active model "${config.model}" is not in availableModels — falling back to default.`)
    config.model = config.availableModels.includes(DEFAULT_CONFIG.model)
      ? DEFAULT_CONFIG.model
      : config.availableModels[0]
  }

  return config
}

function validateUpdates(updates, availableModels) {
  if (updates.temperature !== undefined) {
    if (
      typeof updates.temperature !== 'number' ||
      updates.temperature < MIN_TEMPERATURE ||
      updates.temperature > MAX_TEMPERATURE
    ) {
      throw new Error(`"temperature" must be a number between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}.`)
    }
  }
  if (updates.maxTokens !== undefined) {
    if (
      typeof updates.maxTokens !== 'number' ||
      !Number.isInteger(updates.maxTokens) ||
      updates.maxTokens < MIN_MAX_TOKENS ||
      updates.maxTokens > MAX_MAX_TOKENS
    ) {
      throw new Error(`"maxTokens" must be a whole number between ${MIN_MAX_TOKENS} and ${MAX_MAX_TOKENS}.`)
    }
  }
  if (updates.model !== undefined) {
    if (typeof updates.model !== 'string' || !availableModels.includes(updates.model)) {
      throw new Error(`"model" must be one of the configured available models: ${availableModels.join(', ')}.`)
    }
  }
  if (updates.enableTokenLimit !== undefined && typeof updates.enableTokenLimit !== 'boolean') {
    throw new Error('"enableTokenLimit" must be a boolean.')
  }
  if (updates.additionalInstructions !== undefined && typeof updates.additionalInstructions !== 'string') {
    throw new Error('"additionalInstructions" must be a string.')
  }
  if (
    updates.promptOverride !== undefined &&
    updates.promptOverride !== null &&
    typeof updates.promptOverride !== 'string'
  ) {
    throw new Error('"promptOverride" must be a string or null.')
  }
}

export function saveAiConfig(updates) {
  const current = readConfigFile()
  const availableModels =
    Array.isArray(current.availableModels) && current.availableModels.length > 0
      ? current.availableModels
      : DEFAULT_CONFIG.availableModels

  validateUpdates(updates, availableModels)

  const next = { ...current }
  for (const key of ALLOWED_UPDATE_KEYS) {
    if (updates[key] !== undefined) next[key] = updates[key]
  }

  writeConfigFile(next)
  return getAiConfig()
}

export function resetAiConfig() {
  writeConfigFile({ ...DEFAULT_CONFIG })
  return getAiConfig()
}

export function addAvailableModel(modelName) {
  if (typeof modelName !== 'string' || !modelName.trim()) {
    throw new Error('A non-empty model name is required.')
  }
  const trimmed = modelName.trim()
  const current = readConfigFile()
  const availableModels = Array.isArray(current.availableModels)
    ? current.availableModels
    : [...DEFAULT_CONFIG.availableModels]

  if (availableModels.includes(trimmed)) {
    throw new Error(`"${trimmed}" is already in the list.`)
  }

  writeConfigFile({ ...current, availableModels: [...availableModels, trimmed] })
  return getAiConfig()
}

export function removeAvailableModel(modelName) {
  const current = readConfigFile()
  const availableModels = Array.isArray(current.availableModels)
    ? current.availableModels
    : [...DEFAULT_CONFIG.availableModels]

  if (!availableModels.includes(modelName)) {
    throw new Error(`"${modelName}" is not in the list.`)
  }
  if (modelName === current.model) {
    throw new Error('Cannot remove the currently active model. Switch to a different model first.')
  }
  if (availableModels.length === 1) {
    throw new Error('Cannot remove the last remaining model.')
  }

  writeConfigFile({ ...current, availableModels: availableModels.filter((m) => m !== modelName) })
  return getAiConfig()
}
