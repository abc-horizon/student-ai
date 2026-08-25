// Explores what the second Moodle WS token (MOODLE_WS_TOKEN_ZOHO, bound to the
// "Moodle-Zoho Integration Service") can actually reach, specifically to answer: is there ANY
// working path — via this token or the original one (MOODLE_WS_TOKEN) — to READ BTEC grading
// criteria from Moodle?
//
// READ-ONLY / EXPLORATION ONLY: every call in this script is either a "get_site_info",
// "get_definitions", or a deliberately probed "get_*"/"list_*" candidate name. Nothing that
// creates, deletes, or updates data is ever called, even to test whether it exists — calling a
// create/delete function to "check if it exists" would risk mutating real Moodle data, which
// is out of scope for this exploration.
//
// Uses the same 3-way Moodle error taxonomy established in check-grading-functions.mjs
// (verified empirically against this install on 2026-08-25):
//   - dml_missing_record_exception / errorcode 'invalidrecordunknown' => function name is not
//     registered as a web service function on this Moodle install at all.
//   - webservice_access_exception / errorcode 'accessexception' => function exists, but this
//     token isn't permitted to call it.
//   - invalid_parameter_exception / errorcode 'invalidparameter' => function exists AND this
//     token is permitted — it only failed because the parameters sent were wrong/incomplete.
//
// Prints no student data (names/emails/grades).
//
// Usage: node src/scripts/explore-zoho-service.mjs   (run from backend/)

import 'dotenv/config'

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_ORIGINAL = process.env.MOODLE_WS_TOKEN
const TOKEN_ZOHO = process.env.MOODLE_WS_TOKEN_ZOHO

if (!MOODLE_BASE_URL || !TOKEN_ORIGINAL || !TOKEN_ZOHO) {
  console.error('MOODLE_BASE_URL, MOODLE_WS_TOKEN and MOODLE_WS_TOKEN_ZOHO must all be set in backend/.env.')
  process.exit(1)
}

// Read-only/exploratory candidates ONLY. A create/delete/update function must never be called
// here, even to probe for its existence — block on the presence of a mutating verb ANYWHERE in
// the name (not just as a prefix), since e.g. "..._sync_create_..." has the verb in the middle.
const MUTATING_VERB_PATTERN = /create|delete|update|save|remove|revert|lock|unlock|submit|start|reveal/i
function assertReadOnlyName(name) {
  if (name === 'core_webservice_get_site_info') return // always safe, called unconditionally above
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

function classificationLabel(classification) {
  return {
    EXISTS_BUT_NOT_PERMITTED: 'موجودة على Moodle لكن هذا التوكن غير مصرّح له بها (Access control exception)',
    DOES_NOT_EXIST: 'غير موجودة أصلاً على هذا التنصيب (dml_missing_record_exception)',
    EXISTS_AND_PERMITTED_BAD_PARAMS: 'موجودة ومسموحة لهذا التوكن — الخطأ بسبب معاملات ناقصة/خاطئة فقط',
    OTHER_ERROR: 'خطأ آخر غير مصنّف',
  }[classification]
}

async function main() {
  console.log('=== الخطوة 1: core_webservice_get_site_info بالتوكن الجديد (Zoho) ===\n')

  let zohoFunctions = []
  try {
    const siteInfo = await callMoodleWs(TOKEN_ZOHO, 'core_webservice_get_site_info')
    zohoFunctions = (siteInfo.functions || []).map((f) => f.name)
    console.log(`اسم الموقع: ${siteInfo.sitename}`)
    console.log(`عدد الـ functions المتاحة لتوكن Zoho: ${zohoFunctions.length}\n`)
    console.log(zohoFunctions.sort().join(', '))
    console.log('')
  } catch (err) {
    console.error('core_webservice_get_site_info (Zoho token) فشل:', err.message)
    process.exit(1)
  }

  let originalFunctions = []
  try {
    const siteInfoOriginal = await callMoodleWs(TOKEN_ORIGINAL, 'core_webservice_get_site_info')
    originalFunctions = (siteInfoOriginal.functions || []).map((f) => f.name)
  } catch (err) {
    console.error('core_webservice_get_site_info (التوكن الأصلي) فشل — ما بقدر أقارن:', err.message)
  }

  if (originalFunctions.length > 0) {
    const originalSet = new Set(originalFunctions)
    const zohoSet = new Set(zohoFunctions)
    const onlyInZoho = zohoFunctions.filter((f) => !originalSet.has(f)).sort()
    const onlyInOriginal = originalFunctions.filter((f) => !zohoSet.has(f)).sort()

    console.log('=== المقارنة بين التوكنين ===\n')
    console.log(`متاح في Zoho فقط (${onlyInZoho.length}):`)
    console.log(onlyInZoho.length ? onlyInZoho.map((f) => `  - ${f}`).join('\n') : '  (لا يوجد)')
    console.log('')
    console.log(`متاح بالتوكن الأصلي فقط (${onlyInOriginal.length}):`)
    console.log(onlyInOriginal.length ? onlyInOriginal.map((f) => `  - ${f}`).join('\n') : '  (لا يوجد)')
    console.log('')
  }

  console.log('=== الخطوة 2: core_grading_get_definitions بتوكن Zoho ===\n')
  const inZohoList = zohoFunctions.includes('core_grading_get_definitions')
  console.log(`موجودة بقائمة صلاحيات توكن Zoho؟ ${inZohoList ? 'نعم' : 'لا'}`)
  let gradingDefResult
  try {
    await callMoodleWs(TOKEN_ZOHO, 'core_grading_get_definitions', { cmid: 595, areaname: 'submissions' })
    console.log('النتيجة: نجح الاستدعاء فعلياً!')
    gradingDefResult = { outcome: 'SUCCESS' }
  } catch (err) {
    const classification = classifyError(err)
    console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
    console.log(`التصنيف: ${classificationLabel(classification)}`)
    gradingDefResult = { outcome: classification, error: err.message }
  }
  console.log('')

  console.log('=== الخطوة 3: استكشاف local_mzi_get_moodle_ids (بمعاملات ناقصة) ===\n')
  let mziGetIdsResult
  try {
    await callMoodleWs(TOKEN_ZOHO, 'local_mzi_get_moodle_ids', {})
    console.log('النتيجة: نجح الاستدعاء حتى بدون معاملات (نادر لكن ممكن).')
    mziGetIdsResult = { outcome: 'SUCCESS' }
  } catch (err) {
    const classification = classifyError(err)
    console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
    console.log(`التصنيف: ${classificationLabel(classification)}`)
    if (classification !== 'EXISTS_AND_PERMITTED_BAD_PARAMS') {
      console.log('(ملاحظة: هذه ليست حالة "معاملات ناقصة" — راجع التصنيف أعلاه، رسالة الخطأ لن تكشف أسماء معاملات هنا.)')
    } else {
      console.log('(موجودة ومسموحة — لكن الرسالة العامة "Invalid parameter value detected" لا تكشف أسماء المعاملات المتوقعة إذا كان debug mode مطفي على مستوى الموقع.)')
    }
    mziGetIdsResult = { outcome: classification, error: err.message }
  }
  console.log('')

  console.log('=== الخطوة 4: أسماء محتملة لدوال قراءة غير موثّقة (candidates) ===\n')
  const candidateNames = [
    'local_mzi_get_btec_definition',
    'local_mzi_get_btec_definitions',
    'local_mzi_list_btec_definitions',
    'local_moodle_zoho_sync_get_btec_definition',
  ]
  const candidateResults = []
  for (const name of candidateNames) {
    console.log(`--- ${name} ---`)
    console.log(`موجودة بقائمة صلاحيات توكن Zoho؟ ${zohoFunctions.includes(name) ? 'نعم' : 'لا'}`)
    try {
      await callMoodleWs(TOKEN_ZOHO, name, {})
      console.log('النتيجة: نجح الاستدعاء فعلياً!')
      candidateResults.push({ name, outcome: 'SUCCESS' })
    } catch (err) {
      const classification = classifyError(err)
      console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
      console.log(`التصنيف: ${classificationLabel(classification)}`)
      candidateResults.push({ name, outcome: classification, error: err.message })
    }
    console.log('')
  }

  console.log('=== التقرير الحاسم النهائي ===\n')

  const anySuccess =
    gradingDefResult.outcome === 'SUCCESS' ||
    mziGetIdsResult.outcome === 'SUCCESS' ||
    candidateResults.some((r) => r.outcome === 'SUCCESS')
  const anyPermittedButBadParams =
    gradingDefResult.outcome === 'EXISTS_AND_PERMITTED_BAD_PARAMS' ||
    mziGetIdsResult.outcome === 'EXISTS_AND_PERMITTED_BAD_PARAMS' ||
    candidateResults.some((r) => r.outcome === 'EXISTS_AND_PERMITTED_BAD_PARAMS')

  if (anySuccess) {
    console.log('✅ يوجد مسار يعمل فعلياً الآن لقراءة بيانات عبر أحد التوكنين — راجع التفاصيل أعلاه.')
  } else if (anyPermittedButBadParams) {
    console.log('🟡 يوجد function واحد على الأقل موجود ومسموح فعلياً لتوكن Zoho، لكن شكل معاملاته الصحيح غير معروف')
    console.log('   (الرسالة العامة لا تكشف أسماء المعاملات لأن debug mode مطفي على مستوى الموقع).')
    console.log('   هذا ليس "لا يوجد مسار نهائياً" — لكنه أيضاً ليس مساراً مؤكد النجاح حالياً.')
  } else {
    console.log('❌ لا يوجد أي مسار عبر أي من التوكنين (الأصلي أو Zoho) لقراءة تعريفات معايير BTEC من Moodle حالياً.')
  }

  console.log('')
  console.log('ملخص لكل مسار تم اختباره:')
  console.log(`  core_grading_get_definitions (توكن Zoho): ${classificationLabel(gradingDefResult.outcome) || gradingDefResult.outcome}`)
  console.log(`  local_mzi_get_moodle_ids (توكن Zoho): ${classificationLabel(mziGetIdsResult.outcome) || mziGetIdsResult.outcome}`)
  for (const r of candidateResults) {
    console.log(`  ${r.name}: ${classificationLabel(r.outcome) || r.outcome}`)
  }

  const nonexistentCandidates = candidateResults.filter((r) => r.outcome === 'DOES_NOT_EXIST')
  if (nonexistentCandidates.length === candidateResults.length) {
    console.log('')
    console.log('كل الأسماء المحتملة المجرّبة بالخطوة 4 غير مسجّلة أصلاً على هذا التنصيب — لا يبدو أن local_mzi يملك أي دالة قراءة مخفية بهذه الأسماء تحديداً.')
  }
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
