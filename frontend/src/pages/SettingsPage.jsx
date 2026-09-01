import { useState, useEffect, useCallback } from 'react'
import { useTeacher } from '../context/TeacherContext.jsx'

const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 1
const MIN_MAX_TOKENS = 1000
const MAX_MAX_TOKENS = 8000

function SettingsPage() {
  const { teacherFetch, logout } = useTeacher()
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [showOverride, setShowOverride] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [modelTestResults, setModelTestResults] = useState({})
  const [testingModel, setTestingModel] = useState(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const response = await teacherFetch('/api/settings')
      if (!response.ok) throw new Error('Could not load settings.')
      setConfig(await response.json())
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('error')
    }
  }, [teacherFetch])

  useEffect(() => {
    load()
  }, [load])

  async function handleSave() {
    setStatus('saving')
    setErrorMessage(null)
    setSavedAt(null)
    try {
      const response = await teacherFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          temperature: config.temperature,
          model: config.model,
          maxTokens: config.maxTokens,
          enableTokenLimit: config.enableTokenLimit,
          additionalInstructions: config.additionalInstructions,
          promptOverride: config.promptOverride,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not save settings.')
      setConfig(body)
      setSavedAt(Date.now())
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('idle')
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        'Restore all AI settings to their defaults? This also clears any custom prompt override, additional instructions, and any models you added to the list.',
      )
    ) {
      return
    }
    setStatus('saving')
    setErrorMessage(null)
    setSavedAt(null)
    try {
      const response = await teacherFetch('/api/settings/reset', { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not restore defaults.')
      setConfig(body)
      setShowOverride(false)
      setModelTestResults({})
      setSavedAt(Date.now())
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err.message)
      setStatus('idle')
    }
  }

  async function handleAddModel() {
    if (!newModelName.trim()) return
    setErrorMessage(null)
    try {
      const response = await teacherFetch('/api/settings/models', {
        method: 'POST',
        body: JSON.stringify({ model: newModelName.trim() }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not add model.')
      setConfig(body)
      setNewModelName('')
    } catch (err) {
      setErrorMessage(err.message)
    }
  }

  async function handleRemoveModel(modelName) {
    setErrorMessage(null)
    try {
      const response = await teacherFetch(`/api/settings/models/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not remove model.')
      setConfig(body)
      setModelTestResults((prev) => {
        const next = { ...prev }
        delete next[modelName]
        return next
      })
    } catch (err) {
      setErrorMessage(err.message)
    }
  }

  async function handleTestModel(modelName) {
    setTestingModel(modelName)
    try {
      const response = await teacherFetch(`/api/settings/models/${encodeURIComponent(modelName)}/test`, {
        method: 'POST',
      })
      const result = await response.json()
      setModelTestResults((prev) => ({ ...prev, [modelName]: result }))
    } catch (err) {
      setModelTestResults((prev) => ({ ...prev, [modelName]: { ok: false, error: err.message } }))
    } finally {
      setTestingModel(null)
    }
  }

  if (status === 'loading' || !config) {
    return <div className="p-10 text-center text-gray-500">Loading settings...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-[820px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">AI Settings</h1>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">
            Log Out
          </button>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
        )}

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Model & Behavior</h2>

          <label className="mb-2 block text-sm font-medium text-gray-700">Active Model</label>
          <select
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            {config.availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-sm font-medium text-gray-700">Temperature: {config.temperature}</label>
          <input
            type="range"
            min={MIN_TEMPERATURE}
            max={MAX_TEMPERATURE}
            step={0.1}
            value={config.temperature}
            onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
            className="mb-1 w-full"
          />
          <p className="mb-4 text-xs text-gray-500">
            Higher = more varied output. Lower = more precise and consistent. Default: 0.
          </p>

          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">Max Tokens: {config.maxTokens}</label>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Enable token limit</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.enableTokenLimit}
                onClick={() => setConfig({ ...config, enableTokenLimit: !config.enableTokenLimit })}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  config.enableTokenLimit ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.enableTokenLimit ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
          <input
            type="range"
            min={MIN_MAX_TOKENS}
            max={MAX_MAX_TOKENS}
            step={100}
            value={config.maxTokens}
            disabled={!config.enableTokenLimit}
            onChange={(e) => setConfig({ ...config, maxTokens: Number(e.target.value) })}
            className={`mb-1 w-full ${!config.enableTokenLimit ? 'accent-gray-400 opacity-40' : ''}`}
          />
          <p className="text-xs text-gray-500">
            {config.enableTokenLimit
              ? `Maximum length of the AI's response, in tokens (range ${MIN_MAX_TOKENS}-${MAX_MAX_TOKENS}). Too low can cut a long report off mid-way through.`
              : 'No token limit will be sent to the AI at all — the response length is unrestricted.'}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Available Models</h2>

          <ul className="mb-4 space-y-2">
            {config.availableModels.map((m) => {
              const result = modelTestResults[m]
              return (
                <li
                  key={m}
                  className="flex flex-col gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{m}</span>
                    {m === config.model && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestModel(m)}
                      disabled={testingModel === m}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {testingModel === m ? 'Testing...' : 'Test Model'}
                    </button>
                    <button
                      onClick={() => handleRemoveModel(m)}
                      disabled={m === config.model || config.availableModels.length === 1}
                      title={m === config.model ? 'Cannot remove the active model' : ''}
                      className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                  {result && (
                    <div
                      className={`w-full text-xs sm:w-auto ${
                        result.ok && !result.modelMismatch ? 'text-green-700' : 'text-red-600'
                      }`}
                    >
                      {!result.ok && `Failed: ${result.error}`}
                      {result.ok && !result.modelMismatch && `Works — replied "${result.sampleReply}".`}
                      {result.ok &&
                        result.modelMismatch &&
                        `Warning: the API silently used "${result.resolvedModel}" instead of "${result.requestedModel}" — this model name may not be recognized.`}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            The DeepSeek endpoint this tool uses can silently fall back to its own default model
            when given a name it does not recognize, with no error. Always press "Test Model"
            after adding one, and check whether the reported model matches what you typed.
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="e.g. deepseek-v4-pro"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleAddModel}
              disabled={!newModelName.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Add Model
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Prompt Customization</h2>

          <label className="mb-2 block text-sm font-medium text-gray-700">Additional Instructions</label>
          <textarea
            value={config.additionalInstructions || ''}
            onChange={(e) => setConfig({ ...config, additionalInstructions: e.target.value })}
            rows={4}
            placeholder="Text appended to the end of the AI's instructions — it does not replace anything."
            className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />

          <button
            onClick={() => setShowOverride((v) => !v)}
            className="mb-2 text-sm font-medium text-blue-700 hover:text-blue-800"
          >
            {showOverride ? 'Hide' : 'Show'} full prompt override (advanced)
          </button>

          {showOverride && (
            <div className="mb-4">
              <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                Warning: this replaces the ENTIRE prompt sent to the AI. A mistake here can stop
                the tool from working — or from producing usable reports — for every student. It
                also removes the built-in safeguards (no grades, no plagiarism/AI accusations, no
                rewriting the student's work), the 14 fixed criterion names, the 3 fixed status
                values, and the required JSON schema — you must include all of these yourself if
                you replace the prompt, or reports will fail validation. Use "Restore Defaults"
                below to undo this at any time.
              </div>
              <textarea
                value={config.promptOverride || ''}
                onChange={(e) => setConfig({ ...config, promptOverride: e.target.value || null })}
                rows={10}
                placeholder="Leave empty to use the default prompt below."
                className="w-full rounded-md border border-red-300 px-3 py-2 font-mono text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
          )}

          <label className="mb-2 block text-sm font-medium text-gray-700">
            Current Prompt Actually In Use (read-only)
          </label>
          <textarea
            value={config.currentPrompt || ''}
            readOnly
            rows={12}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleReset}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Restore Defaults
          </button>
          <div className="flex items-center gap-3">
            {savedAt && status === 'idle' && <span className="text-xs text-green-700">Saved.</span>}
            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {status === 'saving' ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
