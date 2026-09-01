import { DEFAULT_SYSTEM_PROMPT } from './systemPrompt.default.js'
import { getAiConfig } from '../services/aiConfigService.js'

export { DEFAULT_SYSTEM_PROMPT }

// Re-read from ai-config.json on every call (via getAiConfig, which itself re-reads the file
// each time) so a change saved through /api/settings takes effect on the very next AI request,
// with no server restart.
export function getSystemPrompt() {
  const config = getAiConfig()

  if (config.promptOverride) {
    return config.promptOverride
  }

  if (config.additionalInstructions) {
    return `${DEFAULT_SYSTEM_PROMPT}\n\n=== ADDITIONAL INSTRUCTIONS (added via Settings) ===\n${config.additionalInstructions}`
  }

  return DEFAULT_SYSTEM_PROMPT
}
