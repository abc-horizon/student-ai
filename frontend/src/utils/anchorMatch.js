// Locates an issue's anchorText inside the student's extracted submission text.
//
// An exact substring match is tried first, because when the AI quotes correctly that is
// what happens and it is the cheapest path. It often does not survive contact with real
// documents though: extraction collapses layout into whitespace differently from how the
// text appeared to the model, so a quote that is verbatim in meaning can still differ by
// a run of spaces, a line break, or a non-breaking space. The fallback therefore matches
// on a whitespace-collapsed, case-folded copy while keeping a map back to the original
// offsets, so the highlight still lands on the true characters in the real text.
function normalize(source) {
  let normalized = ''
  const offsets = []
  let previousWasSpace = false

  for (let index = 0; index < source.length; index++) {
    const char = source[index]

    if (/\s/.test(char)) {
      // Leading whitespace is dropped entirely; interior runs collapse to one space.
      if (!previousWasSpace && normalized.length > 0) {
        normalized += ' '
        offsets.push(index)
      }
      previousWasSpace = true
      continue
    }

    normalized += char.toLowerCase()
    offsets.push(index)
    previousWasSpace = false
  }

  return { normalized, offsets }
}

// Returns { start, end } as offsets into `source`, or null when the anchor cannot be found.
export function findAnchor(source, anchor) {
  if (typeof source !== 'string' || typeof anchor !== 'string') return null

  const trimmedAnchor = anchor.trim()
  if (!source || !trimmedAnchor) return null

  const exact = source.indexOf(trimmedAnchor)
  if (exact !== -1) {
    return { start: exact, end: exact + trimmedAnchor.length }
  }

  const haystack = normalize(source)
  const needle = normalize(trimmedAnchor)
  if (!needle.normalized) return null

  const at = haystack.normalized.indexOf(needle.normalized)
  if (at === -1) return null

  const lastIndex = at + needle.normalized.length - 1
  return { start: haystack.offsets[at], end: haystack.offsets[lastIndex] + 1 }
}
