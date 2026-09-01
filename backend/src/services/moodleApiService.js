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

// Unlike getAssignmentBrief(), these are used by an explicit, admin-triggered sync action —
// callers should surface failures rather than have them silently swallowed.
//
// Confirmed 2026-09-01: lms.abchorizon.com is the only Moodle site this project uses.
// MOODLE_WS_TOKEN_PROF is the token bound to it (same pairing as getConfig() above) —
// MOODLE_WS_TOKEN_NEW is bound to elearning.abchorizon.com, which is unrelated to this project,
// and returns "Invalid token - token not found" against lms.abchorizon.com (verified directly).
function requireConfig() {
  const baseUrl = process.env.MOODLE_SYNC_BASE_URL || process.env.MOODLE_BASE_URL
  const token = process.env.MOODLE_WS_TOKEN_PROF || process.env.MOODLE_WS_TOKEN_NEW
  if (!baseUrl || !token) {
    throw new Error('MOODLE_BASE_URL / MOODLE_WS_TOKEN_PROF are not configured.')
  }
  return { baseUrl, token }
}

export async function getCourseInfo(courseId) {
  const config = requireConfig()
  const data = await callMoodleWs(config, 'core_course_get_courses', { 'options[ids][0]': courseId })
  const course = (Array.isArray(data) ? data : []).find((c) => String(c.id) === String(courseId))
  if (!course) throw new Error(`core_course_get_courses returned no match for course ${courseId}.`)
  return { fullname: course.fullname, shortname: course.shortname }
}

// module.customdata is a JSON-encoded string (Moodle serializes it as text even though it's
// structured data) carrying assign-specific fields like duedate — parse defensively since its
// shape isn't part of any documented contract.
function readDueDateFromModule(module) {
  try {
    const customData = JSON.parse(module.customdata || '{}')
    if (customData.duedate) return new Date(Number(customData.duedate) * 1000).toISOString()
  } catch {
    // fall through to the dates[] fallback below
  }
  const dueEntry = (module.dates || []).find((d) => d.dataid === 'duedate')
  return dueEntry ? new Date(dueEntry.timestamp * 1000).toISOString() : null
}

export async function listCourseAssignments(courseId) {
  const config = requireConfig()

  // Deliberately sourced entirely from core_course_get_contents rather than
  // mod_assign_get_assignments: real courses on this Moodle instance sometimes give
  // "User is not enrolled or does not have requested capability" for the latter even when the
  // former succeeds (observed against elearning.abchorizon.com) — core_course_get_contents
  // already carries everything needed (module.instance is the assign instance id,
  // module.description is the intro HTML, module.customdata/dates carry the due date).
  const contents = await callMoodleWs(config, 'core_course_get_contents', { courseid: courseId })
  const assignModules = []
  for (const section of contents) {
    for (const module of section.modules || []) {
      if (module.modname === 'assign') assignModules.push(module)
    }
  }

  return assignModules.map((module) => ({
    cmid: module.id,
    assignId: module.instance,
    name: module.name,
    intro: stripHtml(module.description),
    dueDate: readDueDateFromModule(module),
  }))
}

export async function listEnrolledStudents(courseId) {
  const config = requireConfig()
  const users = await callMoodleWs(config, 'core_enrol_get_enrolled_users', { courseid: courseId })

  // Keep only users with a student role — enrolled users also include teachers/TAs, which
  // shouldn't show up in a per-student grading roster.
  return (Array.isArray(users) ? users : [])
    .filter((user) => (user.roles || []).some((role) => role.shortname === 'student'))
    .map((user) => ({
      moodleUserId: user.id,
      fullname: user.fullname,
      email: user.email || null,
    }))
}

// assignId is the mod_assign *instance* id (see listCourseAssignments' assignId field above),
// not the cmid.
export async function listSubmissions(assignId) {
  const config = requireConfig()
  const data = await callMoodleWs(config, 'mod_assign_get_submissions', { 'assignmentids[0]': assignId })
  const submissions = (data.assignments || [])[0]?.submissions || []

  return submissions
    .filter((submission) => submission.status !== 'new') // "new" = no submission made yet
    .map((submission) => {
      const files = []
      for (const plugin of submission.plugins || []) {
        if (plugin.type !== 'file') continue
        for (const area of plugin.fileareas || []) {
          for (const file of area.files || []) {
            files.push({ filename: file.filename, fileurl: file.fileurl, filesize: file.filesize })
          }
        }
      }
      return {
        moodleUserId: submission.userid,
        status: submission.status,
        timemodified: submission.timemodified ? new Date(submission.timemodified * 1000).toISOString() : null,
        files,
      }
    })
}

// fileUrl comes from listSubmissions() output, which a client can pass back verbatim as a query
// param — restrict to MOODLE_BASE_URL before ever fetching it so this can't be turned into an
// open proxy for arbitrary URLs (SSRF).
export async function downloadFile(fileUrl) {
  const config = requireConfig()
  const base = config.baseUrl.replace(/\/+$/, '')
  if (!fileUrl.startsWith(base + '/')) {
    throw new Error('fileUrl is not a Moodle file URL for the configured MOODLE_BASE_URL.')
  }

  const url = new URL(fileUrl)
  url.searchParams.set('token', config.token)
  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} while downloading file.`)
  return response
}
