import { useCallback, useEffect, useRef, useState } from 'react'
import { findAnchor } from '../utils/anchorMatch.js'

const HIGHLIGHT_VISIBLE_MS = 2500

function ToggleButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

function FilePreview({ launchToken, mode, onModeChange, anchorRequest, onAnchorResolved }) {
  const [text, setText] = useState(null)
  const [loadState, setLoadState] = useState('idle')
  const [match, setMatch] = useState(null)
  const [faded, setFaded] = useState(false)

  const markRef = useRef(null)
  const scrollRef = useRef(null)
  const fetchStartedRef = useRef(false)
  const mountedRef = useRef(true)

  const isInteractive = mode === 'interactive'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Fetched once per mount, the first time the interactive view is actually asked for —
  // the original view is the default, so most students never pay for this request.
  //
  // The "already started" flag is a ref rather than loadState, and loadState is deliberately
  // NOT a dependency here. When it was, setLoadState('loading') re-ran this effect, whose
  // cleanup cancelled the very request that was still in flight: the pane sat on "loading"
  // forever, and a jump then produced neither a highlight nor a not-found message.
  useEffect(() => {
    if (!isInteractive || !launchToken || fetchStartedRef.current) return

    fetchStartedRef.current = true
    setLoadState('loading')

    fetch(`${import.meta.env.VITE_API_BASE_URL}/api/review/submission-text?launchToken=${encodeURIComponent(launchToken)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then((body) => {
        if (!mountedRef.current) return
        setText(typeof body.text === 'string' ? body.text : '')
        setLoadState('ready')
      })
      .catch(() => {
        if (!mountedRef.current) return
        setLoadState('error')
      })
  }, [isInteractive, launchToken])

  // Resolve a jump request once the text is actually available. The request carries a nonce
  // so clicking the same issue twice re-triggers this rather than being deduped as no change.
  useEffect(() => {
    if (!anchorRequest || !isInteractive) return
    if (loadState === 'idle' || loadState === 'loading') return

    if (loadState === 'error' || !text) {
      onAnchorResolved(false)
      return
    }

    const found = findAnchor(text, anchorRequest.text)
    setMatch(found)
    onAnchorResolved(Boolean(found))
  }, [anchorRequest, isInteractive, loadState, text, onAnchorResolved])

  // Scroll to the highlight and let it fade, without clearing it — the passage stays gently
  // marked so the student does not lose the spot after the colour dims.
  useEffect(() => {
    if (!match || !markRef.current) return

    markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFaded(false)

    const timer = setTimeout(() => setFaded(true), HIGHLIGHT_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [match])

  const switchMode = useCallback(
    (nextMode) => {
      if (nextMode !== mode) onModeChange(nextMode)
    },
    [mode, onModeChange],
  )

  if (!launchToken) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-400">
        No preview available for this file
      </div>
    )
  }

  const src = `${import.meta.env.VITE_API_BASE_URL}/api/review/submission?launchToken=${encodeURIComponent(launchToken)}`

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <span className="text-sm font-bold text-gray-900">Submitted Original File</span>
        <div className="flex shrink-0 rounded-lg border border-gray-200 p-0.5">
          <ToggleButton active={!isInteractive} onClick={() => switchMode('original')}>
            Original View
          </ToggleButton>
          <ToggleButton active={isInteractive} onClick={() => switchMode('interactive')}>
            Interactive View
          </ToggleButton>
        </div>
      </div>

      {!isInteractive ? (
        /* Deliberately not sandbox="…": Chrome's built-in PDF viewer refuses to run in a
           sandboxed frame (any value), so the pane would show a broken-file icon for every
           PDF. The untrusted case is the .docx-derived HTML, and the server sandboxes that
           one via its CSP header. */
        <iframe src={src} title="Assignment file preview" className="w-full flex-1" />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {loadState === 'loading' && <p className="text-sm text-gray-500">Preparing text…</p>}

          {loadState === 'error' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Could not load the file's text. You can go back to "Original View".
            </p>
          )}

          {loadState === 'ready' && !text && (
            <p className="text-sm text-gray-500">No extractable text is available in this file.</p>
          )}

          {loadState === 'ready' && text && (
            <p className="whitespace-pre-wrap text-sm leading-loose text-gray-800">
              {match ? (
                <>
                  {text.slice(0, match.start)}
                  <mark
                    ref={markRef}
                    className={`rounded px-0.5 transition-colors duration-1000 ${
                      faded ? 'bg-amber-100 text-gray-900' : 'bg-amber-300 text-gray-900'
                    }`}
                  >
                    {text.slice(match.start, match.end)}
                  </mark>
                  {text.slice(match.end)}
                </>
              ) : (
                text
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default FilePreview
