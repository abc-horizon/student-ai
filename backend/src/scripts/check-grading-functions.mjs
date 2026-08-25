// Definitively answers: is there ANY Moodle Web Services path available to this token for
// pulling BTEC grading-form definitions (P1-D3 criteria text)?
//
// Two independent checks, because they answer different questions:
//   1. Keyword search over the token's allowed function list (core_webservice_get_site_info)
//      — finds anything relevant that we might not already know the exact name of.
//   2. Direct calls to 3 specific candidate functions, regardless of whether step 1 found them
//      — this distinguishes "function doesn't exist on this Moodle install at all" (Moodle
//      returns an "invalid function" style exception) from "function exists but this token
//      isn't allowed to call it" (accessexception / "Access control exception"). That
//      distinction decides whether the fix is "add a permission" or "there's nothing to add".
//
// Prints no student data (names/emails/grades) — none of the calls made here return any.
//
// Usage: node src/scripts/check-grading-functions.mjs   (run from backend/)

import 'dotenv/config'

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const MOODLE_WS_TOKEN = process.env.MOODLE_WS_TOKEN

if (!MOODLE_BASE_URL || !MOODLE_WS_TOKEN) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN must both be set in backend/.env.')
  process.exit(1)
}

const KEYWORDS = ['grading', 'grade', 'rubric', 'btec', 'zoho', 'definition', 'criteri']

// Tried with no params (or the minimal shape Moodle needs to even reach the permission check).
// Since these calls aren't expected to succeed, params only need to be plausible enough that a
// missing-permission check happens before a missing-parameter check would.
const CANDIDATE_FUNCTIONS = [
  { name: 'core_grading_get_definitions', params: { cmid: 595, areaname: 'submissions' } },
  { name: 'core_grading_get_gradingform_instances', params: { areaname: 'submissions', formname: 'rubric' } },
  { name: 'local_moodle_zoho_sync_create_btec_definition', params: {} },
]

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

  if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
    const err = new Error(data.message || data.exception)
    err.errorcode = data.errorcode
    err.moodleException = data.exception
    throw err
  }

  return data
}

// Moodle's exception shape differs by failure reason (verified empirically against this
// install on 2026-08-25 by calling a deliberately made-up function name and comparing):
//   - Function not permitted for this token: exception 'webservice_access_exception',
//     errorcode 'accessexception', message "Access control exception".
//   - Function name not registered as a web service function at all (checked with a
//     nonexistent function name and it produced the exact same error): exception
//     'dml_missing_record_exception', errorcode 'invalidrecordunknown',
//     message "Can't find data record in database." — NOT 'invalidfunction' as might be
//     assumed; Moodle looks up the function by name in a DB table and reports a generic
//     "record not found" when the lookup misses, before any access check runs.
//   - Function registered AND permitted, but called with bad/missing parameters:
//     exception 'invalid_parameter_exception', errorcode 'invalidparameter'.
function classifyError(err) {
  if (err.errorcode === 'accessexception' || /access control exception/i.test(err.message || '')) {
    return 'EXISTS_BUT_NOT_PERMITTED'
  }
  if (err.errorcode === 'invalidrecordunknown' || /dml_missing_record_exception/i.test(err.moodleException || '')) {
    return 'DOES_NOT_EXIST'
  }
  if (err.errorcode === 'invalidparameter') {
    return 'EXISTS_AND_PERMITTED_BAD_PARAMS'
  }
  return 'OTHER_ERROR'
}

async function main() {
  console.log('=== الخطوة 1: core_webservice_get_site_info + بحث بالكلمات المفتاحية ===\n')

  let allowedFunctions = []
  try {
    const siteInfo = await callMoodleWs('core_webservice_get_site_info')
    allowedFunctions = (siteInfo.functions || []).map((f) => f.name)
    console.log(`إجمالي الـ functions المتاحة لهذا التوكن: ${allowedFunctions.length}\n`)
  } catch (err) {
    console.error('core_webservice_get_site_info فشل — ما بقدر أكمل البحث بالكلمات المفتاحية:', err.message)
    process.exit(1)
  }

  const matchesByKeyword = {}
  for (const keyword of KEYWORDS) {
    matchesByKeyword[keyword] = allowedFunctions.filter((name) => name.toLowerCase().includes(keyword.toLowerCase()))
  }

  let anyKeywordMatch = false
  for (const keyword of KEYWORDS) {
    const matches = matchesByKeyword[keyword]
    console.log(`--- كلمة مفتاحية: "${keyword}" (${matches.length} نتيجة) ---`)
    if (matches.length === 0) {
      console.log('  (لا يوجد)')
    } else {
      anyKeywordMatch = true
      for (const name of matches) console.log(`  - ${name}`)
    }
  }
  console.log('')
  if (!anyKeywordMatch) {
    console.log('لا توجد أي function بالقائمة المسموحة تحتوي على أي من الكلمات المفتاحية المطلوبة.\n')
  }

  console.log('=== الخطوة 2: استدعاء مباشر لـ 3 functions محددة (بغض النظر عن ظهورها بالقائمة) ===\n')

  const directResults = []
  for (const candidate of CANDIDATE_FUNCTIONS) {
    const inAllowedList = allowedFunctions.includes(candidate.name)
    console.log(`--- ${candidate.name} ---`)
    console.log(`موجودة بقائمة صلاحيات التوكن (core_webservice_get_site_info)؟ ${inAllowedList ? 'نعم' : 'لا'}`)

    try {
      await callMoodleWs(candidate.name, candidate.params)
      console.log('النتيجة: نجح الاستدعاء فعلياً (بدون استثناء).')
      directResults.push({ name: candidate.name, inAllowedList, outcome: 'SUCCESS' })
    } catch (err) {
      const classification = classifyError(err)
      console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
      console.log(
        `التصنيف: ${
          classification === 'EXISTS_BUT_NOT_PERMITTED'
            ? 'موجودة لكن غير مسموحة لهذا التوكن (Access control exception)'
            : classification === 'DOES_NOT_EXIST'
              ? 'غير موجودة أصلاً على تنصيب Moodle هذا (dml_missing_record_exception — نفس رسالة استدعاء اسم غير موجود)'
              : classification === 'EXISTS_AND_PERMITTED_BAD_PARAMS'
                ? 'موجودة ومسموحة فعلياً لهذا التوكن — الخطأ بسبب معاملات ناقصة/خاطئة فقط'
                : 'خطأ آخر (راجع الرسالة أعلاه)'
        }`,
      )
      directResults.push({ name: candidate.name, inAllowedList, outcome: classification, error: err.message, errorcode: err.errorcode })
    }
    console.log('')
  }

  console.log('=== التقرير النهائي: هل يوجد مسار متاح لسحب المعايير عبر هذا التوكن؟ ===\n')

  const anyGetPathAvailable = directResults.some(
    (r) => r.outcome === 'SUCCESS' && (r.name.includes('get_definitions') || r.name.includes('get_gradingform_instances')),
  )
  const permittedGetFunctions = directResults.filter(
    (r) => r.inAllowedList && (r.name.includes('get_definitions') || r.name.includes('get_gradingform_instances')),
  )

  if (anyGetPathAvailable || permittedGetFunctions.length > 0) {
    console.log('✅ يوجد مسار متاح فعلياً لسحب المعايير بهذا التوكن.')
  } else {
    console.log('❌ لا يوجد أي مسار متاح حالياً لسحب المعايير (grading definitions) بهذا التوكن.')
    console.log('')
    console.log('التفاصيل:')
    for (const r of directResults) {
      if (r.name === 'local_moodle_zoho_sync_create_btec_definition') continue
      const status =
        r.outcome === 'EXISTS_BUT_NOT_PERMITTED'
          ? 'موجودة على Moodle لكن التوكن غير مصرّح له بها'
          : r.outcome === 'DOES_NOT_EXIST'
            ? 'غير موجودة على هذا التنصيب أصلاً'
            : r.outcome === 'SUCCESS'
              ? 'نجحت (راجع أعلاه)'
              : 'خطأ غير مصنّف — راجع الرسالة أعلاه'
      console.log(`  - ${r.name}: ${status}`)
    }
  }

  const zohoResult = directResults.find((r) => r.name === 'local_moodle_zoho_sync_create_btec_definition')
  if (zohoResult) {
    console.log('')
    console.log('ملاحظة عن local_moodle_zoho_sync_create_btec_definition:')
    console.log(
      `  هذه function مخصصة (local plugin) بالاسم يوحي أنها تُنشئ/تُزامن تعريف معيار BTEC (create) وليس تجلبه (get) —`,
    )
    console.log(
      `  حتى لو نجح الاستدعاء أو كانت مسموحة، غالباً مش الأداة الصحيحة لسحب (قراءة) المعايير الحالية. النتيجة الفعلية: ${zohoResult.outcome}${zohoResult.error ? ' — "' + zohoResult.error + '"' : ''}`,
    )
  }

  if (
    !anyGetPathAvailable &&
    permittedGetFunctions.length === 0 &&
    directResults.some((r) => r.outcome === 'EXISTS_BUT_NOT_PERMITTED')
  ) {
    console.log('')
    console.log(
      'الخلاصة: الـ functions موجودة على تنصيب Moodle لكنها غير مفعّلة لهذا التوكن — الحل هو إضافتها من',
    )
    console.log('Site administration → Server → Web services → External services، وليس مشكلة بالكود.')
  }
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
