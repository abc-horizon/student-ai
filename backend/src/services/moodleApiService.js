// Best-effort fetch of a Moodle assignment's brief (title + instructions + due date), to give
// reviewAssignment() real context instead of the empty briefText it's always been called with.
//
// MUST NEVER break the student-facing review flow: every failure mode (missing token, wrong
// Moodle instance, network error, timeout, missing/ambiguous assignment) is caught here and
// resolved to `null` — callers fall back to '' exactly as before. This is deliberate, not
// defensive boilerplate: at the time this was written, the token in MOODLE_WS_TOKEN_PROF is
// bound to lms.abchorizon.com, while the real production courses run on
// elearning.abchorizon.com — so in production this will likely find nothing for a while, and
// that must be an unremarkable no-op, not a degraded or broken review.
//
// LTI's assignmentId is `lti:{contextId}:{resourceLinkId}`. In this Moodle's LTI setup,
// contextId maps directly to the Moodle courseId (verified against real launch data). There is
// no known mapping from resourceLinkId to a specific assignment's cmid, though — the LTI tool is
// launched as its own external-tool activity, not attached to a specific mod_assign instance.
// So: if a course has exactly one assignment, we use it; if it has zero or more than one, we
// skip rather than guess which one the student is actually working on (using the wrong
// assignment's brief would be worse than using none).

const TIMEOUT_MS = 5000

function getConfig() {
  const baseUrl = process.env.MOODLE_BASE_URL
  const token = process.env.MOODLE_WS_TOKEN_PROF
  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

async function callMoodleWs(config, wsfunction, extraParams) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`
    const body = new URLSearchParams({
      wstoken: config.token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...extraParams,
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const data = await response.json()
    if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
      throw new Error(data.message || data.exception)
    }
    return data
  } finally {
    clearTimeout(timeoutId)
  }
}

// Moodle's `intro` field is HTML. No HTML parser is in this project's dependencies, so this is
// a deliberately simple tag-stripper — good enough for typical assignment instructions
// (paragraphs, line breaks, bold/lists), not a general-purpose HTML sanitizer.
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function getAssignmentBrief({ courseId, resourceLinkId }) {
  const config = getConfig()
  if (!config) return null // no MOODLE_WS_TOKEN_PROF configured — normal, silent no-op
  if (!courseId) return null

  try {
    const contents = await callMoodleWs(config, 'core_course_get_contents', { courseid: courseId })
    const assignModules = []
    for (const section of contents) {
      for (const module of section.modules || []) {
        if (module.modname === 'assign') assignModules.push(module)
      }
    }

    if (assignModules.length === 0) {
      console.warn(`[moodleApiService] Course ${courseId} has no assign module — skipping brief.`)
      return null
    }
    if (assignModules.length > 1) {
      console.warn(
        `[moodleApiService] Course ${courseId} has ${assignModules.length} assign modules and resourceLinkId ` +
          `${resourceLinkId} cannot be mapped to a specific one — skipping brief rather than risking the wrong assignment's instructions.`,
      )
      return null
    }

    const cmid = assignModules[0].id
    const assignData = await callMoodleWs(config, 'mod_assign_get_assignments', { 'courseids[0]': courseId })
    const courseEntry = (assignData.courses || [])[0]
    const assignment = courseEntry?.assignments?.find((a) => a.cmid === cmid)
    if (!assignment) {
      console.warn(`[moodleApiService] mod_assign_get_assignments returned no match for cmid ${cmid} in course ${courseId}.`)
      return null
    }

    return {
      title: assignment.name,
      brief: stripHtml(assignment.intro),
      dueDate: assignment.duedate ? new Date(assignment.duedate * 1000).toISOString() : null,
    }
  } catch (err) {
    console.warn(`[moodleApiService] getAssignmentBrief failed for course ${courseId} — continuing with no brief: ${err.message}`)
    return null
  }
}
