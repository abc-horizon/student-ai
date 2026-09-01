// Status check of the Moodle WS token (MOODLE_WS_TOKEN_PROF) currently in backend/.env, plus a
// live test of moodleApiService.getAssignmentBrief() (the feature actually wired into
// review.js). Answers: does the token work, and what does it concretely pull successfully vs
// fail to pull, right now.
//
// The original MOODLE_WS_TOKEN and MOODLE_WS_TOKEN_ZOHO tokens this script used to also check
// were removed from backend/.env on 2026-08-25 after being confirmed permanently revoked on the
// Moodle side ("Invalid token - token not found") — see backend/eval-data/moodle-api-findings.md
// for what they used to expose. Only MOODLE_WS_TOKEN_PROF remains.
//
// READ-ONLY: only get_/search_/site_info-style functions are called.
// Prints no student data — course/module/rubric-definition metadata only.
//
// Usage: node src/scripts/verify-moodle-api.mjs   (run from backend/)

import 'dotenv/config'
import { getAssignmentBrief } from '../services/moodleApiService.js'

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKENS = [{ label: 'MOODLE_WS_TOKEN_PROF', value: process.env.MOODLE_WS_TOKEN_PROF }]

const PILOT_COURSE_ID = 513
const PILOT_CMIDS = [595, 597] // course 513's 2 assign modules, from earlier discovery

const MUTATING_VERB_PATTERN = /create|delete|update|save|submit|remove|revert|lock|unlock|start|reveal|enrol/i
function assertReadOnlyName(name) {
  if (MUTATING_VERB_PATTERN.test(name)) {
    throw new Error(`Refusing to call "${name}" — name contains a mutating verb. Aborting for safety.`)
  }
}

async function callMoodleWs(token, wsfunction, extraParams = {}) {
  assertReadOnlyName(wsfunction)
  const url = `${MOODLE_BASE_URL.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json', ...extraParams })
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const data = await response.json()
  if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
    const err = new Error(data.message || data.exception)
    err.errorcode = data.errorcode
    throw err
  }
  return data
}

async function main() {
  if (!MOODLE_BASE_URL) {
    console.error('MOODLE_BASE_URL is not set in backend/.env.')
    process.exit(1)
  }

  console.log('=== فحص التوكن ===\n')
  const tokenStatus = []

  for (const token of TOKENS) {
    console.log(`--- ${token.label} ---`)
    if (!token.value) {
      console.log('غير موجود بـ.env.\n')
      tokenStatus.push({ label: token.label, valid: false, functionCount: 0, hasGradingDefinitions: false, note: 'غير موجود بـ.env' })
      continue
    }
    try {
      const siteInfo = await callMoodleWs(token.value, 'core_webservice_get_site_info')
      const functions = (siteInfo.functions || []).map((f) => f.name)
      const hasGradingDefinitions = functions.includes('core_grading_get_definitions')
      console.log(`✅ صالح. عدد الـ functions: ${functions.length}`)
      console.log(`core_grading_get_definitions متاحة؟ ${hasGradingDefinitions ? '✅ نعم' : '❌ لا'}`)
      tokenStatus.push({ label: token.label, valid: true, functionCount: functions.length, hasGradingDefinitions, value: token.value })
    } catch (err) {
      console.log(`❌ غير صالح. رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
      tokenStatus.push({ label: token.label, valid: false, functionCount: 0, hasGradingDefinitions: false, note: err.message })
    }
    console.log('')
  }

  const workingToken = tokenStatus.find((t) => t.valid && t.hasGradingDefinitions) || tokenStatus.find((t) => t.valid)

  if (!workingToken) {
    console.log('لا يوجد أي توكن صالح — توقفت هنا.')
    printFinalTable(tokenStatus, {})
    return
  }

  console.log(`=== استخدام "${workingToken.label}" للخطوات 4-6 (المقرر التجريبي ${PILOT_COURSE_ID}) ===\n`)
  const capabilities = { courseContents: false, assignmentsFetched: false, gradingDefinitionsFetched: false }

  console.log('--- core_course_get_contents ---')
  let contents
  try {
    contents = await callMoodleWs(workingToken.value, 'core_course_get_contents', { courseid: PILOT_COURSE_ID })
    const assignModules = contents.flatMap((s) => s.modules || []).filter((m) => m.modname === 'assign')
    console.log(`✅ نجح. عدد أنشطة assign الموجودة: ${assignModules.length} (cmid: ${assignModules.map((m) => m.id).join(', ')})`)
    capabilities.courseContents = true
  } catch (err) {
    console.log(`❌ فشل: "${err.message}"`)
  }
  console.log('')

  console.log('--- mod_assign_get_assignments ---')
  try {
    const assignData = await callMoodleWs(workingToken.value, 'mod_assign_get_assignments', { 'courseids[0]': PILOT_COURSE_ID })
    const assignments = assignData.courses?.[0]?.assignments || []
    console.log(`✅ نجح. ${assignments.length} واجب:`)
    for (const a of assignments) {
      const introSnippet = (a.intro || '').slice(0, 200)
      console.log(`  - العنوان: "${a.name}"`)
      console.log(`    أول 200 حرف من intro: "${introSnippet}${(a.intro || '').length > 200 ? '...' : ''}"`)
      console.log(`    يفتح: ${new Date(a.allowsubmissionsfromdate * 1000).toISOString()} | يستحق: ${new Date(a.duedate * 1000).toISOString()}`)
    }
    capabilities.assignmentsFetched = assignments.length > 0
  } catch (err) {
    console.log(`❌ فشل: "${err.message}"`)
  }
  console.log('')

  console.log('--- core_grading_get_definitions (cmids[0]=...) ---')
  for (const cmid of PILOT_CMIDS) {
    try {
      const result = await callMoodleWs(workingToken.value, 'core_grading_get_definitions', { 'cmids[0]': cmid, areaname: 'submissions' })
      console.log(`cmid=${cmid}: ${JSON.stringify(result)}`)
      const area = result.areas?.[0]
      if (area?.activemethod && area?.definitions?.length > 0) capabilities.gradingDefinitionsFetched = true
    } catch (err) {
      console.log(`cmid=${cmid}: فشل — "${err.message}"`)
    }
  }
  console.log('')

  console.log('=== الخطوة 7: getAssignmentBrief على المقرر التجريبي 513 ===\n')
  const start1 = performance.now()
  const briefResult = await getAssignmentBrief({ courseId: String(PILOT_COURSE_ID), resourceLinkId: '1' })
  const elapsed1 = (performance.now() - start1).toFixed(1)
  console.log(`النتيجة: ${JSON.stringify(briefResult)}`)
  console.log(`زمن الاستجابة: ${elapsed1}ms`)
  console.log(
    briefResult === null
      ? '(متوقع: null — المقرر 513 فيه واجبان، والدالة ترفض التخمين بينهم عمداً، موثّق بالكود)'
      : '',
  )
  console.log('')

  console.log('=== الخطوة 8: getAssignmentBrief على مقرر غير موجود (اختبار فشل آمن) ===\n')
  const start2 = performance.now()
  let safeFailureResult
  let threwException = false
  try {
    safeFailureResult = await getAssignmentBrief({ courseId: '999999999', resourceLinkId: '1' })
  } catch (err) {
    threwException = true
    safeFailureResult = `EXCEPTION: ${err.message}`
  }
  const elapsed2 = (performance.now() - start2).toFixed(1)
  console.log(`النتيجة: ${JSON.stringify(safeFailureResult)}`)
  console.log(`رمى استثناء؟ ${threwException ? '❌ نعم (هذا خطأ - المفروض ما يصير)' : '✅ لا'}`)
  console.log(`زمن الاستجابة: ${elapsed2}ms`)
  console.log('')

  printFinalTable(tokenStatus, capabilities, { briefResult, briefElapsed: elapsed1, safeFailureOk: !threwException && safeFailureResult === null })
}

function printFinalTable(tokenStatus, capabilities, briefInfo = {}) {
  console.log('=== الجدول النهائي ===\n')
  console.log('التوكنات:')
  for (const t of tokenStatus) {
    console.log(
      `  ${t.valid ? '✅' : '❌'} ${t.label}: ${
        t.valid ? `${t.functionCount} function، core_grading_get_definitions=${t.hasGradingDefinitions ? 'نعم' : 'لا'}` : t.note
      }`,
    )
  }
  console.log('')
  console.log('ما يُسحب فعلياً بنجاح (بالمقرر التجريبي 513):')
  console.log(`  ${capabilities.courseContents ? '✅' : '❌'} core_course_get_contents`)
  console.log(`  ${capabilities.assignmentsFetched ? '✅' : '❌'} mod_assign_get_assignments (عنوان + intro + مواعيد)`)
  console.log(`  ${capabilities.gradingDefinitionsFetched ? '✅' : '❌'} core_grading_get_definitions (رابريك فعلي — لا يوجد بالمقرر 513)`)
  console.log(`  ${briefInfo.briefResult ? '✅' : '❌'} getAssignmentBrief (moodleApiService.js) — ${briefInfo.briefResult ? 'نجح' : 'null (متوقع بسبب ازدواج الواجبات بالمقرر 513)'}`)
  console.log(`  ${briefInfo.safeFailureOk ? '✅' : '❌'} فشل آمن (مقرر غير موجود → null بدون استثناء)`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
