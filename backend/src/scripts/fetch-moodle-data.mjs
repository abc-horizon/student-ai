// Pulls assignment metadata and BTEC grading-form definitions (P1-D3 criteria) directly from
// Moodle's Web Services REST API, so this project doesn't have to keep them hardcoded.
//
// Runs a fixed sequence of calls against course id 513 (the pilot course):
//   1. core_webservice_get_site_info      — must run first: confirms the token works and
//                                            lists exactly which functions it's allowed to call.
//   2. core_course_get_contents           — finds the assign module instances (cmid) in the course.
//   3. mod_assign_get_assignments         — title, intro (instructions), open/due dates.
//   4. core_grading_get_definitions       — the actual BTEC criteria text (areaname='submissions').
//
// Each call is attempted independently and its outcome recorded, so one missing permission
// doesn't stop the others from running. Does not print any student data (names/emails/grades) —
// none of these 4 functions return any, but this is called out explicitly since that guarantee
// matters for this script's purpose.
//
// Usage: node src/scripts/fetch-moodle-data.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-api-dump.json')
const PILOT_COURSE_ID = 513

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const MOODLE_WS_TOKEN = process.env.MOODLE_WS_TOKEN

if (!MOODLE_BASE_URL || !MOODLE_WS_TOKEN) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN must both be set in backend/.env.')
  process.exit(1)
}

async function callMoodleWs(wsfunction, extraParams = {}) {
  const url = `${MOODLE_BASE_URL.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({
    wstoken: MOODLE_WS_TOKEN,
    wsfunction,
    moodlewsrestformat: 'json',
    ...extraParams,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  // Moodle WS errors come back as HTTP 200 with an "exception"/"errorcode" body, not as HTTP errors.
  if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
    const err = new Error(data.message || data.exception)
    err.errorcode = data.errorcode
    err.moodleException = data.exception
    throw err
  }

  return data
}

function isMissingPermissionError(err) {
  // Moodle's standard errorcode for "token can't call this function" is accessexception /
  // "Access control exception" with errorcode 'accessexception', or 'invalidparameter' for
  // functions the token doesn't know about at all in some setups.
  return err.errorcode === 'accessexception' || /access control exception/i.test(err.message || '')
}

async function main() {
  const results = {
    fetchedAt: new Date().toISOString(),
    moodleBaseUrl: MOODLE_BASE_URL,
    pilotCourseId: PILOT_COURSE_ID,
    calls: {},
  }
  const callReport = []
  const missingPermissions = []

  // --- 1. core_webservice_get_site_info ---
  let allowedFunctions = null
  try {
    const siteInfo = await callMoodleWs('core_webservice_get_site_info')
    allowedFunctions = new Set((siteInfo.functions || []).map((f) => f.name))
    results.calls.core_webservice_get_site_info = siteInfo
    callReport.push({ call: 'core_webservice_get_site_info', status: 'success' })

    console.log('=== core_webservice_get_site_info ===')
    console.log(`اسم الموقع: ${siteInfo.sitename}`)
    console.log(`إصدار Moodle: ${siteInfo.release} (version ${siteInfo.version})`)
    console.log(`عدد الـ functions المتاحة لهذا التوكن: ${allowedFunctions.size}`)
    console.log([...allowedFunctions].sort().join(', '))
    console.log('')
  } catch (err) {
    results.calls.core_webservice_get_site_info = { error: err.message, errorcode: err.errorcode }
    callReport.push({ call: 'core_webservice_get_site_info', status: 'failed', error: err.message })
    console.error('core_webservice_get_site_info فشل:', err.message)
    console.error('بدون هذا الاستدعاء ما بقدر أتحقق من صلاحيات التوكن بدقة — رح أكمل الباقي بمحاولة مباشرة.')
    console.log('')
  }

  function checkPermission(wsfunction) {
    if (allowedFunctions && !allowedFunctions.has(wsfunction)) {
      missingPermissions.push(wsfunction)
      return false
    }
    return true
  }

  // --- 2. core_course_get_contents (pilot course) ---
  let cmids = []
  checkPermission('core_course_get_contents')
  try {
    const contents = await callMoodleWs('core_course_get_contents', { courseid: PILOT_COURSE_ID })
    results.calls.core_course_get_contents = contents

    for (const section of contents) {
      for (const module of section.modules || []) {
        if (module.modname === 'assign') {
          cmids.push(module.id)
        }
      }
    }

    callReport.push({ call: 'core_course_get_contents', status: 'success', details: `${cmids.length} assign module(s) found` })
    console.log('=== core_course_get_contents (course 513) ===')
    console.log(`cmid للواجبات (assign modules): ${cmids.join(', ') || '(لا يوجد)'}`)
    console.log('')
  } catch (err) {
    results.calls.core_course_get_contents = { error: err.message, errorcode: err.errorcode }
    callReport.push({
      call: 'core_course_get_contents',
      status: 'failed',
      error: err.message,
      missingPermission: isMissingPermissionError(err) ? 'core_course_get_contents' : null,
    })
    console.error('core_course_get_contents فشل:', err.message)
    console.log('')
  }

  // --- 3. mod_assign_get_assignments ---
  checkPermission('mod_assign_get_assignments')
  let assignIds = []
  try {
    const assignData = await callMoodleWs('mod_assign_get_assignments', {
      'courseids[0]': PILOT_COURSE_ID,
    })
    results.calls.mod_assign_get_assignments = assignData

    const courseEntry = (assignData.courses || [])[0]
    const assignments = courseEntry ? courseEntry.assignments : []
    assignIds = assignments.map((a) => a.id)

    callReport.push({ call: 'mod_assign_get_assignments', status: 'success', details: `${assignments.length} assignment(s) found` })
    console.log('=== mod_assign_get_assignments (course 513) ===')
    for (const a of assignments) {
      console.log(`- [${a.id}] "${a.name}" — يفتح: ${new Date(a.allowsubmissionsfromdate * 1000).toISOString()}, يغلق: ${new Date(a.duedate * 1000).toISOString()}`)
    }
    console.log('')
  } catch (err) {
    results.calls.mod_assign_get_assignments = { error: err.message, errorcode: err.errorcode }
    callReport.push({
      call: 'mod_assign_get_assignments',
      status: 'failed',
      error: err.message,
      missingPermission: isMissingPermissionError(err) ? 'mod_assign_get_assignments' : null,
    })
    console.error('mod_assign_get_assignments فشل:', err.message)
    console.log('')
  }

  // --- 4. core_grading_get_definitions (areaname='submissions') ---
  // Needs a contextid per assignment (usually derived from the assignment's cmid via
  // core_course_get_contents module.id, which Moodle treats as the module context id source).
  checkPermission('core_grading_get_definitions')
  const gradingResults = []
  const cmidsToTry = cmids.length ? cmids : assignIds // fall back if step 2 failed but step 3 didn't
  for (const cmid of cmidsToTry) {
    try {
      const def = await callMoodleWs('core_grading_get_definitions', {
        cmid,
        areaname: 'submissions',
      })
      gradingResults.push({ cmid, result: def })
      callReport.push({ call: `core_grading_get_definitions(cmid=${cmid})`, status: 'success' })
    } catch (err) {
      gradingResults.push({ cmid, error: err.message, errorcode: err.errorcode })
      callReport.push({
        call: `core_grading_get_definitions(cmid=${cmid})`,
        status: 'failed',
        error: err.message,
        missingPermission: isMissingPermissionError(err) ? 'core_grading_get_definitions' : null,
      })
      console.error(`core_grading_get_definitions فشل لـ cmid=${cmid}:`, err.message)
    }
  }
  results.calls.core_grading_get_definitions = gradingResults
  console.log('=== core_grading_get_definitions ===')
  console.log(`تمت محاولة ${cmidsToTry.length} cmid(s)، نجح ${gradingResults.filter((r) => !r.error).length}.`)
  console.log('')

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf8')
  console.log(`النتائج الكاملة محفوظة في: ${OUT_PATH}`)
  console.log('')

  // --- Final report ---
  console.log('=== تقرير نهائي: أي استدعاء نجح وأي واحد فشل ===')
  for (const r of callReport) {
    console.log(`${r.status === 'success' ? '✅' : '❌'} ${r.call}${r.details ? ' — ' + r.details : ''}${r.error ? ' — ' + r.error : ''}`)
  }

  const allMissingPermissions = [...new Set([...missingPermissions, ...callReport.filter((r) => r.missingPermission).map((r) => r.missingPermission)])]

  if (allMissingPermissions.length > 0) {
    console.log('')
    console.log('الصلاحيات الناقصة على هذا التوكن — أضفها من Site administration → Server → Web services → External services:')
    for (const fn of allMissingPermissions) {
      console.log(`  - ${fn}`)
    }
  } else if (callReport.some((r) => r.status === 'failed')) {
    console.log('')
    console.log('في استدعاءات فشلت لكن السبب مش صلاحية مفقودة بالضرورة (راجع رسائل الخطأ أعلاه — قد يكون معرّف مقرر/cmid خاطئ أو سبب آخر).')
  } else {
    console.log('')
    console.log('كل الاستدعاءات نجحت.')
  }
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
