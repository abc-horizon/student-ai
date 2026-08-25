// Tests the third Moodle WS token (MOODLE_WS_TOKEN_PROF, given by the admin — possibly bound to
// a broader-permission service) specifically for: does it finally have access to
// core_grading_get_definitions, the function every previous token was denied?
//
// READ-ONLY: the only function ever called with a real effect is core_webservice_get_site_info
// and core_grading_get_definitions. assertReadOnlyName() below refuses anything containing a
// mutating verb (create/delete/update/save/submit/...), even as a candidate name to probe.
//
// Prints no student data (names/emails/grades/userids) — none of the calls made here return
// per-student data by design (course 513 contents/grading definitions are course-level, not
// per-student).
//
// Usage: node src/scripts/test-prof-token.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const RUBRIC_REFERENCE_PATH = path.join(BACKEND_DIR, 'src', 'knowledge', 'sustainable-energy-rubric.json')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-grading-definitions-prof-token.json')

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_ORIGINAL = process.env.MOODLE_WS_TOKEN
const TOKEN_ZOHO = process.env.MOODLE_WS_TOKEN_ZOHO
const TOKEN_PROF = process.env.MOODLE_WS_TOKEN_PROF

if (!MOODLE_BASE_URL || !TOKEN_ORIGINAL || !TOKEN_ZOHO || !TOKEN_PROF) {
  console.error('MOODLE_BASE_URL, MOODLE_WS_TOKEN, MOODLE_WS_TOKEN_ZOHO and MOODLE_WS_TOKEN_PROF must all be set in backend/.env.')
  process.exit(1)
}

const KEYWORDS = ['grading', 'rubric', 'btec', 'definition']
const PILOT_CMIDS = [595, 597] // course 513, from earlier core_course_get_contents dump

const MUTATING_VERB_PATTERN = /create|delete|update|save|submit|remove|revert|lock|unlock|start|reveal|enrol/i
function assertReadOnlyName(name) {
  if (MUTATING_VERB_PATTERN.test(name)) {
    throw new Error(`Refusing to call "${name}" — name contains a mutating verb. Aborting for safety.`)
  }
}

async function callMoodleWs(token, wsfunction, extraParams = {}) {
  assertReadOnlyName(wsfunction)
  const url = `${MOODLE_BASE_URL.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({
    wstoken: token,
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
    err.debuginfo = data.debuginfo
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

function classificationLabel(classification) {
  return {
    EXISTS_BUT_NOT_PERMITTED: 'موجودة لكن ممنوعة لهذا التوكن (Access control exception)',
    DOES_NOT_EXIST: 'غير موجودة أصلاً (dml_missing_record_exception)',
    EXISTS_AND_PERMITTED_BAD_PARAMS: 'موجودة ومسموحة — معاملات ناقصة/خاطئة فقط',
    OTHER_ERROR: 'خطأ آخر غير مصنّف',
  }[classification]
}

async function main() {
  console.log('=== الخطوة 1: core_webservice_get_site_info بتوكن المشرف (PROF) ===\n')

  let profFunctions = []
  try {
    const siteInfo = await callMoodleWs(TOKEN_PROF, 'core_webservice_get_site_info')
    profFunctions = (siteInfo.functions || []).map((f) => f.name)
    console.log(`اسم الموقع: ${siteInfo.sitename}`)
    console.log(`عدد الـ functions المتاحة لتوكن PROF: ${profFunctions.length}\n`)
  } catch (err) {
    console.error('core_webservice_get_site_info (توكن PROF) فشل:', err.message)
    process.exit(1)
  }

  const hasGradingDefinitions = profFunctions.includes('core_grading_get_definitions')
  console.log(`⭐ core_grading_get_definitions موجودة بقائمة صلاحيات توكن PROF؟ ${hasGradingDefinitions ? '✅ نعم' : '❌ لا'}\n`)

  console.log('=== functions تحتوي على كلمات مفتاحية (grading/rubric/btec/definition) ===\n')
  let anyKeywordMatch = false
  for (const keyword of KEYWORDS) {
    const matches = profFunctions.filter((name) => name.toLowerCase().includes(keyword))
    console.log(`--- "${keyword}" (${matches.length}) ---`)
    if (matches.length === 0) {
      console.log('  (لا يوجد)')
    } else {
      anyKeywordMatch = true
      for (const name of matches) console.log(`  - ${name}`)
    }
  }
  if (!anyKeywordMatch) console.log('\n(لا توجد أي نتيجة لأي كلمة مفتاحية)')
  console.log('')

  console.log('=== الخطوة 2: مقارنة توكن PROF مع التوكنين السابقين ===\n')
  let originalFunctions = []
  let zohoFunctions = []
  try {
    originalFunctions = ((await callMoodleWs(TOKEN_ORIGINAL, 'core_webservice_get_site_info')).functions || []).map((f) => f.name)
  } catch (err) {
    console.error('تعذّر جلب قائمة التوكن الأصلي للمقارنة:', err.message)
  }
  try {
    zohoFunctions = ((await callMoodleWs(TOKEN_ZOHO, 'core_webservice_get_site_info')).functions || []).map((f) => f.name)
  } catch (err) {
    console.error('تعذّر جلب قائمة توكن Zoho للمقارنة:', err.message)
  }

  const knownSet = new Set([...originalFunctions, ...zohoFunctions])
  const onlyInProf = profFunctions.filter((f) => !knownSet.has(f)).sort()
  console.log(`متاح في PROF فقط (غير متاح لا بالأصلي ولا بـZoho) — ${onlyInProf.length} function:`)
  console.log(onlyInProf.length ? onlyInProf.map((f) => `  - ${f}`).join('\n') : '  (لا يوجد — PROF لا يضيف أي صلاحية جديدة غير مسبوقة)')
  console.log('')

  const profSet = new Set(profFunctions)
  const missingFromProf = [...knownSet].filter((f) => !profSet.has(f)).sort()
  console.log(`متاح بالتوكنين السابقين لكن غير متاح بـPROF — ${missingFromProf.length} function (أول 15 فقط للاختصار):`)
  console.log(missingFromProf.slice(0, 15).map((f) => `  - ${f}`).join('\n') || '  (لا يوجد)')
  console.log('')

  console.log('=== الخطوة 3: استدعاء core_grading_get_definitions فعلياً (مقرر 513، cmid 595 و597) ===\n')

  if (!hasGradingDefinitions) {
    console.log('الدالة غير موجودة بقائمة صلاحيات توكن PROF حسب core_webservice_get_site_info — بس رح أجرب الاستدعاء المباشر بكل الأحوال للتأكيد (المصدر الوحيد الموثوق 100% هو نتيجة الاستدعاء الفعلي، مو القائمة).\n')
  }

  let anyDefinitionSuccess = false
  const allDefinitions = []

  for (const cmid of PILOT_CMIDS) {
    console.log(`--- cmid=${cmid}, areaname=submissions ---`)
    try {
      // Moodle's real signature takes cmids as an ARRAY (cmids[0]=...), not a single "cmid" —
      // confirmed empirically: "cmid" alone gave invalidparameter on this token even though the
      // function is permitted; "cmids[0]" succeeded immediately with no debug mode needed.
      const result = await callMoodleWs(TOKEN_PROF, 'core_grading_get_definitions', { 'cmids[0]': cmid, areaname: 'submissions' })
      console.log('✅ نجح الاستدعاء!')
      console.log(JSON.stringify(result, null, 2))
      allDefinitions.push({ cmid, result })
      anyDefinitionSuccess = true
    } catch (err) {
      const classification = classifyError(err)
      console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
      if (err.debuginfo) {
        console.log(`⭐ debuginfo متاح (debug mode مفعّل!): ${err.debuginfo}`)
      }
      console.log(`التصنيف: ${classificationLabel(classification)}`)
    }
    console.log('')
  }

  if (!anyDefinitionSuccess) {
    console.log('لم ينجح أي استدعاء لـ core_grading_get_definitions بتوكن PROF على المقرر التجريبي 513. توقفت هنا — لا انتقال لأي مقرر آخر.')
    return
  }

  // Check whether what came back actually contains a rubric (course 513's assignments are
  // test/placeholder ones — "Word Assignment Test", "TTRTTRTTTTTTRTRTRTR" — not confirmed to
  // have any BTEC rubric attached).
  const hasAnyRubricContent = allDefinitions.some(
    (d) => Array.isArray(d.result?.areas) && d.result.areas.some((areaDef) => areaDef.definitions && areaDef.definitions.length > 0),
  )

  if (!hasAnyRubricContent) {
    console.log('=== الاستدعاء نجح لكن لم يُعثر على أي رابريك فعلي على المقرر التجريبي 513 ===\n')
    console.log('هذا متوقع: واجبات هذا المقرر ("Word Assignment Test", "TTRTTRTTTTTTRTRTRTR") لا يبدو أنها معدّة برابريك BTEC.')
    console.log('توقفت هنا كما طُلب — لن أنتقل لأي مقرر حقيقي بدون تأكيدك.')
    return
  }

  console.log('=== تم العثور على محتوى رابريك فعلي! مقارنة مع sustainable-energy-rubric.json ===\n')
  const referenceRubric = JSON.parse(fs.readFileSync(RUBRIC_REFERENCE_PATH, 'utf8'))
  console.log('معايير مرجعية محلية (sustainable-energy-rubric.json):')
  console.log(referenceRubric.criteria.map((c) => `  ${c.criterion_code}: ${c.criterion_text}`).join('\n'))
  console.log('')
  console.log('قارن يدوياً مع المخرجات المطبوعة أعلاه من Moodle (البنية تختلف حسب نوع أداة التصحيح المتقدم المستخدمة).')

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(allDefinitions, null, 2), 'utf8')
  console.log(`\nمحفوظ في: ${OUT_PATH}`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
