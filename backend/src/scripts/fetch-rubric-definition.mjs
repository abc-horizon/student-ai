// Attempts to fetch the BTEC rubric DEFINITION (criteria names/text/levels) from Moodle via
// gradingform_rubric_grader_gradingpanel_fetch — a Moodle-core "fetch" function (read-only by
// the fetch/store convention used consistently across this whole API family; see the
// conversation this script was written for). It is only available on the "Zoho" WS token, not
// the original one.
//
// SAFETY RULES (non-negotiable, enforced in code below, not just by convention):
//   - Only the pilot course (id 513) and its 2 assign modules are used. No real course is
//     touched without stopping and asking first.
//   - gradeduserid is NEVER a real student id — only deliberately-impossible placeholder ids
//     (see FAKE_USER_IDS) are tried, specifically so a "success" here can never mean we pulled
//     one real student's grade data. Obtaining a real enrolled userid would itself require
//     calling a participants-list function that returns student names/emails, which this
//     script must never do.
//   - Before printing or saving ANY successful response, redactStudentData() strips every key
//     that could carry a student's identity or grade (student/filling/remark/levelid chosen by
//     a grader/userid/etc.) — see the REDACT_KEYS list. Only redacted output is ever printed or
//     written to disk.
//
// Usage: node src/scripts/fetch-rubric-definition.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-rubric-definition.json')
const RUBRIC_REFERENCE_PATH = path.join(BACKEND_DIR, 'src', 'knowledge', 'sustainable-energy-rubric.json')

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_ZOHO = process.env.MOODLE_WS_TOKEN_ZOHO

if (!MOODLE_BASE_URL || !TOKEN_ZOHO) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN_ZOHO must both be set in backend/.env.')
  process.exit(1)
}

// From core_course_get_contents (course 513) — module metadata, not student data.
const PILOT_ASSIGNMENTS = [
  { cmid: 595, instance: 71, contextid: 2702, name: 'Word Assignment Test' },
  { cmid: 597, instance: 72, contextid: 2704, name: 'TTRTTRTTTTTTRTRTRTR' },
]

// Deliberately impossible / obviously-fake ids — never a real enrolled student's id.
const FAKE_USER_IDS = [999999999, 0]

async function callMoodleWs(wsfunction, extraParams = {}) {
  if (!wsfunction.includes('fetch') && !wsfunction.includes('get_')) {
    throw new Error(`Refusing to call "${wsfunction}" — this script only calls read ("fetch"/"get") functions.`)
  }
  const url = `${MOODLE_BASE_URL.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({
    wstoken: TOKEN_ZOHO,
    wsfunction,
    moodlewsrestformat: 'json',
    ...extraParams,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const data = await response.json()
  if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
    const err = new Error(data.message || data.exception)
    err.errorcode = data.errorcode
    err.moodleException = data.exception
    throw err
  }
  return data
}

function classifyError(err) {
  if (err.errorcode === 'accessexception' || /access control exception/i.test(err.message || '')) return 'EXISTS_BUT_NOT_PERMITTED'
  if (err.errorcode === 'invalidrecordunknown' || /dml_missing_record_exception/i.test(err.moodleException || '')) return 'DOES_NOT_EXIST'
  if (err.errorcode === 'invalidparameter') return 'EXISTS_AND_PERMITTED_BAD_PARAMS'
  return 'OTHER_ERROR'
}

// Any key matching these (case-insensitive) is deleted, recursively, no matter how deep or
// what's inside it — better to over-redact than risk leaking a fragment of student data.
const REDACT_KEY_PATTERN =
  /^(student|filling|fillings|remark|remarkformat|levelid|chosenlevel|selectedlevel|grade|grades|feedback|comment|comments|userid|gradeduserid|fullname|firstname|lastname|email|useremail|username|picture|profileimageurl|timemodified|usermodified|gradinginstanceid|instanceid)$/i

function redactStudentData(value) {
  if (Array.isArray(value)) return value.map(redactStudentData)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (REDACT_KEY_PATTERN.test(key)) continue // drop entirely, don't even note it was redacted
      out[key] = redactStudentData(val)
    }
    return out
  }
  return value
}

async function main() {
  console.log('=== الخطوة 1: تصنيف — هل gradingform_rubric_grader_gradingpanel_fetch موجودة/مسموحة؟ ===\n')
  try {
    await callMoodleWs('gradingform_rubric_grader_gradingpanel_fetch', {})
    console.log('غير متوقع: نجح الاستدعاء بدون أي معاملات.')
  } catch (err) {
    const classification = classifyError(err)
    console.log(`استدعاء بدون معاملات => "${err.message}" (errorcode: ${err.errorcode}) — ${classification}`)
    if (classification !== 'EXISTS_AND_PERMITTED_BAD_PARAMS') {
      console.log('\nهذا غير متوقع بناءً على الفحص السابق (كنا نتوقع EXISTS_AND_PERMITTED_BAD_PARAMS). توقفت.')
      return
    }
  }
  console.log('')

  console.log('=== الخطوة 2: محاولة تخمين شكل المعاملات (على المقرر التجريبي 513 فقط، بمعرّفات طالب وهمية) ===\n')

  // Parameter-shape guesses based on the general pattern used by Moodle's other
  // "*_grader_gradingpanel_fetch" functions in this API family (component/contextid/area/itemid
  // + the student being graded). Exact param names are not confirmed — this is exploratory.
  const paramShapeGuesses = (assignment, fakeUserId) => [
    { component: 'mod_assign', contextid: assignment.contextid, area: 'submissions', itemid: assignment.instance, gradeduserid: fakeUserId },
    { component: 'mod_assign', contextid: assignment.contextid, area: 'submissions', itemid: assignment.instance, userid: fakeUserId },
    { contextid: assignment.contextid, itemid: assignment.instance, gradeduserid: fakeUserId },
    { assignmentid: assignment.instance, userid: fakeUserId },
    { cmid: assignment.cmid, userid: fakeUserId },
  ]

  let succeeded = false
  const attempts = []

  outer: for (const assignment of PILOT_ASSIGNMENTS) {
    for (const fakeUserId of FAKE_USER_IDS) {
      for (const params of paramShapeGuesses(assignment, fakeUserId)) {
        const attemptLabel = `assign=${assignment.name} (instance ${assignment.instance}), fakeUserId=${fakeUserId}, params=${JSON.stringify(Object.keys(params))}`
        try {
          const result = await callMoodleWs('gradingform_rubric_grader_gradingpanel_fetch', params)
          console.log(`✅ نجح! ${attemptLabel}`)
          attempts.push({ attemptLabel, outcome: 'SUCCESS' })
          const redacted = redactStudentData(result)
          console.log('\n=== الاستجابة بعد تنقية كاملة من أي بيانات طالب ===')
          console.log(JSON.stringify(redacted, null, 2))
          fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
          fs.writeFileSync(OUT_PATH, JSON.stringify(redacted, null, 2), 'utf8')
          console.log(`\nمحفوظ (منقّى بالكامل) في: ${OUT_PATH}`)
          succeeded = true
          break outer
        } catch (err) {
          const classification = classifyError(err)
          attempts.push({ attemptLabel, outcome: classification, error: err.message })
        }
      }
    }
  }

  if (!succeeded) {
    console.log('لم ينجح أي تشكيل معاملات مجرَّب. كل المحاولات:\n')
    for (const a of attempts) {
      console.log(`  ${a.outcome === 'SUCCESS' ? '✅' : '❌'} ${a.attemptLabel} => ${a.error || 'نجح'}`)
    }
    const allSameGenericError = attempts.every((a) => a.outcome === 'EXISTS_AND_PERMITTED_BAD_PARAMS')
    console.log('')
    if (allSameGenericError) {
      console.log(
        'كل المحاولات رجّعت "Invalid parameter value detected" — نفس القيد يلي واجهناه مع local_mzi:' +
          ' الدالة موجودة ومسموحة فعلياً، لكن شكل معاملاتها الدقيق غير معروف لأن رسائل الخطأ التفصيلية' +
          ' مخفية (debug mode مطفي على مستوى الموقع). التخمين وحده ما كفى هالمرة.',
      )
      console.log(
        'لسحب المعايير عبر هذا المسار فعلياً، الخيارات المتبقية: (أ) الوصول لكود الـplugin/core على' +
          ' السيرفر لمعرفة التوقيع الدقيق، أو (ب) تفعيل debug mode مؤقتاً بموافقتك الصريحة.',
      )
    } else {
      console.log('راجع تفاصيل كل محاولة أعلاه — بعضها قد يكون كشف تصنيف مختلف يستحق المتابعة.')
    }
  }
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
