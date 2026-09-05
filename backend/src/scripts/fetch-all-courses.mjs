// Pulls a read-only structural snapshot of everything on the Moodle instance reachable with
// MOODLE_WS_TOKEN_NEW: categories, courses, course contents (sections/activities), assignment
// metadata, which assignments have a grading form attached (activemethod + form name only — we
// already know the BTEC plugin doesn't expose its criteria text over the API, see
// backend/eval-data/btec-integration-notes.md), and registered LTI tools per course.
//
// STRICT NO-STUDENT-DATA POLICY:
//   - Only course/category/module/assignment/grading-definition *metadata* functions are called.
//   - Every response is passed through redactStudentData() before it is ever printed or saved,
//     as defense in depth — even though none of the called functions should return participant,
//     submission, grade, or user data in the first place.
//   - assertReadOnlyName() refuses to call anything whose name contains a mutating verb, and a
//     hardcoded denylist additionally refuses the specific participant/submission/grade/user
//     functions called out as off-limits, even if a future edit of this script tried to add them.
//
// Usage: node src/scripts/fetch-all-courses.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-courses-full.json')

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN = process.env.MOODLE_WS_TOKEN_NEW

if (!TOKEN) {
  console.error('MOODLE_WS_TOKEN_NEW must be set in backend/.env.')
  process.exit(1)
}

// This token has previously turned out to belong to a different Moodle instance than the one
// named in MOODLE_BASE_URL (see explore-new-token.mjs) — try both.
const CANDIDATE_BASE_URLS = [...new Set([MOODLE_BASE_URL, 'https://elearning.abchorizon.com'].filter(Boolean))]

const DELAY_MS = 100
const CHUNK_SIZE = 50 // for bulk array params (courseids[]/cmids[]) — keeps request URLs sane

// --- Safety: refuse anything that isn't a plain metadata read ---
const MUTATING_VERB_PATTERN = /create|delete|update|save|submit|remove|revert|lock|unlock|start|reveal|enrol/i
const FORBIDDEN_FUNCTIONS = new Set([
  'core_enrol_get_enrolled_users',
  'mod_assign_get_submissions',
  'mod_assign_get_grades',
  'mod_assign_list_participants',
  'core_user_get_users',
  'core_user_get_users_by_field',
  'core_user_get_course_user_profiles',
])
function assertReadOnlyName(name) {
  if (FORBIDDEN_FUNCTIONS.has(name)) {
    throw new Error(`Refusing to call "${name}" — explicitly forbidden (student/participant data). Aborting.`)
  }
  if (MUTATING_VERB_PATTERN.test(name)) {
    throw new Error(`Refusing to call "${name}" — name contains a mutating verb. Aborting for safety.`)
  }
}

// --- Defense in depth: strip anything that looks like it could be student-identifying data
// from any response, before it is ever printed or written to disk.
// NOTE: "fullname" and "grade" are deliberately NOT in this list. None of the functions this
// script calls (categories/courses/contents/assignments/grading-definitions/LTI tools) return
// user profiles or a student's actual grade — mod_assign_get_assignments' "grade" is the
// assignment's configured max points, not any student's score, and "fullname" here is always a
// *course* fullname. If a future edit adds a function that could return a user object or a real
// student grade (mod_assign_get_grades, mod_assign_get_submissions, etc. — already forbidden
// above), redact that response separately instead of adding these keys back here, since doing so
// would blank out every course name and assignment max-grade in this script's legitimate output.
const REDACT_KEY_PATTERN =
  /^(student|students|filling|fillings|remark|remarkformat|levelid|chosenlevel|selectedlevel|feedback|comment|comments|userid|gradeduserid|firstname|lastname|email|useremail|username|picture|profileimageurl|usermodified|participant|participants|submission|submissions)$/i

function redactStudentData(value) {
  if (Array.isArray(value)) return value.map(redactStudentData)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (REDACT_KEY_PATTERN.test(key)) continue
      out[key] = redactStudentData(val)
    }
    return out
  }
  return value
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Same deliberately-simple tag-stripper used elsewhere in this project (moodleApiService.js) —
// good enough for typical Moodle rich-text summaries/instructions, not a general HTML sanitizer.
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

async function callMoodleWs(baseUrl, wsfunction, extraParams = {}) {
  assertReadOnlyName(wsfunction)
  const url = `${baseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({ wstoken: TOKEN, wsfunction, moodlewsrestformat: 'json', ...extraParams })
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const data = await response.json()
  if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
    const err = new Error(data.message || data.exception)
    err.errorcode = data.errorcode
    throw err
  }
  return redactStudentData(data)
}

function arrayParams(name, values) {
  const params = {}
  values.forEach((v, i) => {
    params[`${name}[${i}]`] = v
  })
  return params
}

function buildCategoryPathMap(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const pathCache = new Map()
  function pathFor(id) {
    if (pathCache.has(id)) return pathCache.get(id)
    const cat = byId.get(id)
    if (!cat) return ''
    const parentPath = cat.parent ? pathFor(cat.parent) : ''
    const full = parentPath ? `${parentPath} > ${cat.name}` : cat.name
    pathCache.set(id, full)
    return full
  }
  const result = new Map()
  for (const c of categories) result.set(c.id, pathFor(c.id))
  return result
}

const BTEC_LOOKS_LIKE_PATTERN = /\b\d{4}T\d\b|\bU\d+\b|btec/i

function looksLikeBtec(course) {
  return (
    BTEC_LOOKS_LIKE_PATTERN.test(course.fullname || '') ||
    BTEC_LOOKS_LIKE_PATTERN.test(course.shortname || '') ||
    BTEC_LOOKS_LIKE_PATTERN.test(course.idnumber || '')
  )
}

// Discovered live on this instance: some "assign" activities are one-off, per-student
// instances whose *title* is the student's name/ID (e.g. "LS_ABC422 - A01B4010C - MALIK
// ISMAILOGLU"), not a generic class assignment name. core_course_get_contents and
// mod_assign_get_assignments return these titles as plain "name" text — no key-based redaction
// (REDACT_KEY_PATTERN above) can catch that, since it's the *value* that's sensitive, not the
// key. Anything that looks like it carries this institution's per-student ID code, or ends in a
// dash-separated ALL-CAPS name segment, gets its name replaced before it's ever saved or printed.
const STUDENT_ID_CODE_PATTERN = /\b[A-Z]\d{2}[A-Z]\d{4}[A-Z]\b/
const REDACTED_ACTIVITY_NAME = '[تمت إزالته — يُحتمل أنه يحوي اسم/معرّف طالب]'

function looksLikeContainsStudentIdentifier(text) {
  if (!text) return false
  if (STUDENT_ID_CODE_PATTERN.test(text)) return true
  const segments = text.split(/\s*-\s*/)
  return segments.some((seg) => {
    const trimmed = seg.trim()
    return /^[A-Z][A-Z'’-]*(?:\s+[A-Z][A-Z'’-]*){1,4}$/.test(trimmed) && trimmed.length <= 60
  })
}

let redactedActivityNameCount = 0
function safeActivityName(name) {
  if (looksLikeContainsStudentIdentifier(name)) {
    redactedActivityNameCount++
    return REDACTED_ACTIVITY_NAME
  }
  return name
}

async function main() {
  const startTime = performance.now()
  const errors = []

  function recordError(call, err) {
    errors.push({ call, message: err.message })
    console.error(`❌ ${call} فشل: ${err.message}`)
  }

  // Moodle WS "warnings" (e.g. "User is not enrolled or does not have requested capability")
  // come back as HTTP 200 with an empty result, not as an exception — callMoodleWs() doesn't
  // throw for these, so they'd otherwise pass silently. Aggregated by message so 221
  // per-course warnings collapse into one reported line instead of flooding the output.
  const warningCounts = new Map()
  function recordWarnings(call, warnings) {
    for (const w of warnings || []) {
      const key = `${call}: ${w.message}`
      warningCounts.set(key, (warningCounts.get(key) || 0) + 1)
    }
  }

  // --- Resolve which Moodle instance this token actually points at ---
  let baseUrl = null
  console.log('=== تحديد عنوان الموودل الفعلي للتوكن ===')
  for (const candidate of CANDIDATE_BASE_URLS) {
    try {
      await callMoodleWs(candidate, 'core_webservice_get_site_info')
      baseUrl = candidate
      console.log(`✅ يعمل على: ${candidate}\n`)
      break
    } catch (err) {
      console.log(`❌ ${candidate}: "${err.message}"`)
    }
  }
  if (!baseUrl) {
    console.error('\nالتوكن غير صالح على أي عنوان مجرَّب. توقفت.')
    process.exit(1)
  }

  // --- المرحلة ١: التصنيفات ---
  console.log('=== المرحلة ١: core_course_get_categories ===')
  let categories = []
  try {
    categories = await callMoodleWs(baseUrl, 'core_course_get_categories', {})
    console.log(`✅ ${categories.length} تصنيف.\n`)
  } catch (err) {
    recordError('core_course_get_categories', err)
  }
  const categoryPathById = buildCategoryPathMap(categories)

  // --- المرحلة ٢: المقررات ---
  console.log('=== المرحلة ٢: core_course_get_courses ===')
  let rawCourses = []
  try {
    rawCourses = await callMoodleWs(baseUrl, 'core_course_get_courses', {})
    console.log(`✅ ${rawCourses.length} مقرر (شامل مقرر الموقع id=1).\n`)
  } catch (err) {
    recordError('core_course_get_courses', err)
  }

  const courses = rawCourses
    .filter((c) => c.id !== 1) // exclude the Moodle "site" pseudo-course
    .map((c) => ({
      id: c.id,
      fullname: c.fullname,
      shortname: c.shortname,
      categoryid: c.categoryid,
      idnumber: c.idnumber || '',
      startdate: c.startdate ? new Date(c.startdate * 1000).toISOString() : null,
      enddate: c.enddate ? new Date(c.enddate * 1000).toISOString() : null,
      visible: Boolean(c.visible),
      format: c.format,
      summary: stripHtml(c.summary),
      categoryPath: categoryPathById.get(c.categoryid) || '',
    }))

  // --- المرحلة ٣: محتويات المقررات (لا يوجد استدعاء دفعي — لازم مقرر مقرر مع تأخير) ---
  console.log('=== المرحلة ٣: core_course_get_contents لكل مقرر ===')
  const courseContents = []
  const activityCountsByModname = {}
  let contentsOk = 0
  for (const course of courses) {
    try {
      const sections = await callMoodleWs(baseUrl, 'core_course_get_contents', { courseid: course.id })
      const cleanSections = (sections || []).map((s) => ({
        id: s.id,
        name: s.name,
        modules: (s.modules || []).map((m) => {
          activityCountsByModname[m.modname] = (activityCountsByModname[m.modname] || 0) + 1
          return { modname: m.modname, name: safeActivityName(m.name), cmid: m.id, instance: m.instance, visible: Boolean(m.visible) }
        }),
      }))
      courseContents.push({ courseId: course.id, sections: cleanSections })
      contentsOk++
    } catch (err) {
      recordError(`core_course_get_contents(courseid=${course.id})`, err)
    }
    await sleep(DELAY_MS)
  }
  console.log(`✅ نجح لـ ${contentsOk}/${courses.length} مقرر.\n`)

  // --- المرحلة ٤: الواجبات بالتفصيل ---
  // Base list comes from the "assign" modules already found in stage 3 (core_course_get_contents
  // succeeds for every course regardless of enrollment). mod_assign_get_assignments is still
  // attempted, purely to enrich with intro/duedate/grade/teamsubmission where it's allowed to —
  // see the warning handling below for why it may add nothing.
  console.log('=== المرحلة ٤: mod_assign_get_assignments ===')
  const courseIds = courses.map((c) => c.id)

  const assignments = []
  const assignmentByCmid = new Map()
  for (const cc of courseContents) {
    for (const mod of cc.sections.flatMap((s) => s.modules)) {
      if (mod.modname !== 'assign') continue
      const assignment = {
        id: null, // filled in below if mod_assign_get_assignments succeeds for this course
        cmid: mod.cmid,
        courseId: cc.courseId,
        name: mod.name, // already redacted by safeActivityName() in stage 3
        intro: '',
        duedate: null,
        allowsubmissionsfromdate: null,
        grade: null,
        teamsubmission: null,
        gradingDefinition: null,
      }
      assignments.push(assignment)
      assignmentByCmid.set(mod.cmid, assignment)
    }
  }

  let enrichedCount = 0
  for (const batch of chunk(courseIds, CHUNK_SIZE)) {
    try {
      const data = await callMoodleWs(baseUrl, 'mod_assign_get_assignments', arrayParams('courseids', batch))
      recordWarnings('mod_assign_get_assignments', data.warnings)
      for (const courseEntry of data.courses || []) {
        for (const a of courseEntry.assignments || []) {
          const assignment = assignmentByCmid.get(a.cmid)
          if (!assignment) continue // shouldn't happen — stage 3 already found this cmid
          assignment.id = a.id
          assignment.name = safeActivityName(a.name)
          assignment.intro = stripHtml(a.intro)
          assignment.duedate = a.duedate ? new Date(a.duedate * 1000).toISOString() : null
          assignment.allowsubmissionsfromdate = a.allowsubmissionsfromdate
            ? new Date(a.allowsubmissionsfromdate * 1000).toISOString()
            : null
          assignment.grade = a.grade
          assignment.teamsubmission = Boolean(a.teamsubmission)
          enrichedCount++
        }
      }
    } catch (err) {
      recordError(`mod_assign_get_assignments(courseids batch of ${batch.length})`, err)
    }
    await sleep(DELAY_MS)
  }
  console.log(`✅ ${assignments.length} واجب (من محتويات المقررات)، أُثري منها بالتفصيل ${enrichedCount} (intro/duedate/...).\n`)

  // --- المرحلة ٤ (تابع): core_grading_get_definitions لكل واجب (دفعي بحسب cmids) ---
  console.log('=== المرحلة ٤ (تابع): core_grading_get_definitions (areaname=submissions) ===')
  const assignmentCmids = assignments.map((a) => a.cmid)
  let definitionsFoundCount = 0
  for (const batch of chunk(assignmentCmids, CHUNK_SIZE)) {
    try {
      const result = await callMoodleWs(
        baseUrl,
        'core_grading_get_definitions',
        { ...arrayParams('cmids', batch), areaname: 'submissions' },
      )
      recordWarnings('core_grading_get_definitions', result.warnings)
      for (const area of result.areas || []) {
        const assignment = assignmentByCmid.get(area.cmid)
        if (assignment && area?.activemethod && (area.definitions || []).length > 0) {
          assignment.gradingDefinition = { activemethod: area.activemethod, name: area.definitions[0].name || null }
          definitionsFoundCount++
        }
      }
    } catch (err) {
      recordError(`core_grading_get_definitions(cmids batch of ${batch.length})`, err)
    }
    await sleep(DELAY_MS)
  }
  console.log(`✅ ${definitionsFoundCount} واجب لديه نموذج تصحيح مُطبَّق.\n`)

  // --- المرحلة ٥: أدوات LTI (دفعي بحسب courseids) ---
  console.log('=== المرحلة ٥: mod_lti_get_ltis_by_courses ===')
  let ltiTools = []
  for (const batch of chunk(courseIds, CHUNK_SIZE)) {
    try {
      const data = await callMoodleWs(baseUrl, 'mod_lti_get_ltis_by_courses', arrayParams('courseids', batch))
      recordWarnings('mod_lti_get_ltis_by_courses', data.warnings)
      for (const lti of data.ltis || []) {
        ltiTools.push({
          id: lti.id,
          courseId: lti.course,
          cmid: lti.coursemodule,
          name: lti.name,
          toolurl: lti.toolurl || null,
          visible: lti.visible === undefined ? null : Boolean(lti.visible),
        })
      }
    } catch (err) {
      recordError(`mod_lti_get_ltis_by_courses(courseids batch of ${batch.length})`, err)
    }
    await sleep(DELAY_MS)
  }
  console.log(`✅ ${ltiTools.length} أداة LTI مسجّلة عبر المقررات المفحوصة.\n`)

  const elapsedMs = Math.round(performance.now() - startTime)

  const warnings = [...warningCounts.entries()].map(([key, count]) => ({ key, count }))

  // --- الحفظ ---
  const output = {
    fetchedAt: new Date().toISOString(),
    moodleBaseUrl: baseUrl,
    elapsedMs,
    categories,
    courses,
    courseContents,
    assignments,
    ltiTools,
    errors,
    warnings,
    redactedActivityNameCount,
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(redactStudentData(output), null, 2), 'utf8')
  console.log(`النتائج الكاملة محفوظة في: ${OUT_PATH}\n`)

  // --- تقرير ملخّص ---
  console.log('=== الملخص ===')
  console.log(`التصنيفات: ${categories.length}`)
  console.log(`المقررات: ${courses.length}`)
  console.log('الأنشطة حسب النوع:')
  for (const [modname, count] of Object.entries(activityCountsByModname).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${modname}: ${count}`)
  }
  console.log(`الواجبات (assign): ${assignments.length}`)
  console.log('')

  console.log('=== الواجبات التي لديها نموذج تصحيح مُطبَّق ===')
  const withGradingForm = assignments.filter((a) => a.gradingDefinition)
  if (withGradingForm.length === 0) {
    console.log('(لا يوجد)')
  } else {
    const courseNameById = new Map(courses.map((c) => [c.id, c.fullname]))
    console.log('المقرر | الواجب | activemethod | اسم النموذج')
    for (const a of withGradingForm) {
      console.log(`${courseNameById.get(a.courseId) || a.courseId} | ${a.name} | ${a.gradingDefinition.activemethod} | ${a.gradingDefinition.name || '(بدون اسم)'}`)
    }
  }
  console.log('')

  console.log('=== مقررات تبدو BTEC (نمط 2526T2 / U+رقم / BTEC) ===')
  const btecLikeCourses = courses.filter(looksLikeBtec)
  if (btecLikeCourses.length === 0) {
    console.log('(لا يوجد)')
  } else {
    for (const c of btecLikeCourses) {
      console.log(`id=${c.id} | "${c.fullname}" (${c.shortname}) | ${c.categoryPath}`)
    }
  }
  console.log('')

  console.log('=== استدعاءات فشلت (استثناء صريح) ===')
  if (errors.length === 0) {
    console.log('(لا يوجد)')
  } else {
    for (const e of errors) {
      console.log(`❌ ${e.call}: "${e.message}"`)
    }
  }
  console.log('')

  console.log('=== تحذيرات من Moodle (HTTP 200 بنتيجة فارغة/جزئية — ليست استثناءً) ===')
  if (warnings.length === 0) {
    console.log('(لا يوجد)')
  } else {
    for (const w of warnings) {
      console.log(`⚠️  ${w.key} (×${w.count})`)
    }
    if (warnings.some((w) => w.key.startsWith('mod_assign_get_assignments'))) {
      console.log(
        '  ↳ هذا يعني: حقول intro/duedate/allowsubmissionsfromdate/grade/teamsubmission غير متاحة عبر ' +
          'هذا التوكن لمعظم/كل الواجبات (لأن مستخدم التوكن غير مسجَّل بالمقررات) — قائمة الواجبات ' +
          'نفسها (الاسم/cmid) مبنية من core_course_get_contents بدلاً من ذلك ولم تتأثر.',
      )
    }
  }
  console.log('')

  if (redactedActivityNameCount > 0) {
    console.log(
      `⚠️  تنبيه خصوصية: تم استبدال اسم ${redactedActivityNameCount} نشاط بدت أسماؤها تحتوي معرّف/اسم طالب ` +
        `(نمط أنشطة "assign" فردية لكل طالب موجود فعلياً على هذا الموودل) — راجع moodle-courses-full.json.\n`,
    )
  }

  console.log(`الوقت المستغرق: ${(elapsedMs / 1000).toFixed(1)} ثانية`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
