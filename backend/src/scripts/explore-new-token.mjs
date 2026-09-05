// Explores the newest Moodle WS token (MOODLE_WS_TOKEN_NEW) end-to-end: which Moodle instance
// it points at, what it's permitted to call, and — the actual goal — whether it can reach a
// real BTEC rubric definition anywhere. MOODLE_WS_TOKEN_PROF (the only other live token, per
// backend/eval-data/moodle-api-findings.md) is confirmed bound to lms.abchorizon.com, which
// does not host the real Sustainable Energy course; this checks whether TOKEN_NEW might reach
// elearning.abchorizon.com instead, or otherwise succeed where PROF couldn't.
//
// READ-ONLY: only get_/search_/site_info-style functions are called. assertReadOnlyName()
// refuses anything with a mutating verb, even as a probe.
//
// Prints no student data — only course/module/rubric-definition metadata, and
// redactStudentData() strips anything that could carry a student identity or grade from any
// response before it's ever printed or saved, as defense in depth.
//
// Usage: node src/scripts/explore-new-token.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const RUBRIC_REFERENCE_PATH = path.join(BACKEND_DIR, 'src', 'knowledge', 'sustainable-energy-rubric.json')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-rubric-extracted.json')

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_PROF = process.env.MOODLE_WS_TOKEN_PROF
const TOKEN_NEW = process.env.MOODLE_WS_TOKEN_NEW

if (!MOODLE_BASE_URL || !TOKEN_NEW) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN_NEW must both be set in backend/.env.')
  process.exit(1)
}

// MOODLE_BASE_URL in .env is lms.abchorizon.com — but this token may belong to a DIFFERENT
// Moodle instance (this project already knows of a second one, elearning.abchorizon.com, from
// earlier investigation). "Invalid token" on one instance doesn't mean the token is dead, only
// that it's not registered THERE. So: try MOODLE_BASE_URL first, and fall back to the known
// second instance before giving up.
const CANDIDATE_BASE_URLS = [...new Set([MOODLE_BASE_URL, 'https://elearning.abchorizon.com'])]

const KEYWORDS = ['grading', 'rubric', 'btec', 'definition']
const MAX_COURSES_TO_CHECK = 40
const SEARCH_TERMS = ['Sustainable Energy', 'BTEC', 'U28']

const MUTATING_VERB_PATTERN = /create|delete|update|save|submit|remove|revert|lock|unlock|start|reveal|enrol/i
function assertReadOnlyName(name) {
  if (MUTATING_VERB_PATTERN.test(name)) {
    throw new Error(`Refusing to call "${name}" — name contains a mutating verb. Aborting for safety.`)
  }
}

async function callMoodleWs(baseUrl, token, wsfunction, extraParams = {}) {
  assertReadOnlyName(wsfunction)
  const url = `${baseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`
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

const REDACT_KEY_PATTERN =
  /^(student|students|filling|fillings|remark|remarkformat|levelid|chosenlevel|selectedlevel|grade|grades|feedback|comment|comments|userid|gradeduserid|fullname|firstname|lastname|email|useremail|username|picture|profileimageurl|usermodified)$/i

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

async function main() {
  console.log('=== تحديد أي موودل ينتمي له هذا التوكن ===\n')

  let workingBaseUrl = null
  let siteInfo = null
  for (const candidateUrl of CANDIDATE_BASE_URLS) {
    try {
      const result = await callMoodleWs(candidateUrl, TOKEN_NEW, 'core_webservice_get_site_info')
      workingBaseUrl = candidateUrl
      siteInfo = result
      console.log(`✅ يعمل على: ${candidateUrl}`)
      break
    } catch (err) {
      console.log(`❌ ${candidateUrl}: "${err.message}"`)
    }
  }

  if (!workingBaseUrl) {
    console.error('\nالتوكن غير صالح على أي من العناوين المجرَّبة. توقفت.')
    process.exit(1)
  }

  console.log('')
  console.log('=== المرحلة 1: core_webservice_get_site_info (توكن NEW) ===\n')

  const newFunctions = (siteInfo.functions || []).map((f) => f.name)

  console.log(`⭐ اسم الموقع: "${siteInfo.sitename}"`)
  console.log(`⭐ رابط الموقع (siteurl): "${siteInfo.siteurl || '(غير متوفر بالاستجابة)'}"`)
  console.log(`⭐ العنوان الفعلي المستخدم: ${workingBaseUrl}${workingBaseUrl !== MOODLE_BASE_URL ? ' (⚠️ مختلف عن MOODLE_BASE_URL بـ.env الذي يشير لموودل آخر)' : ' (نفس MOODLE_BASE_URL بـ.env)'}`)
  console.log(`عدد الـ functions المتاحة: ${newFunctions.length}`)
  const hasGradingDefinitions = newFunctions.includes('core_grading_get_definitions')
  console.log(`core_grading_get_definitions متاحة؟ ${hasGradingDefinitions ? '✅ نعم' : '❌ لا'}\n`)

  console.log('=== functions تحتوي كلمات مفتاحية (grading/rubric/btec/definition) ===\n')
  for (const keyword of KEYWORDS) {
    const matches = newFunctions.filter((n) => n.toLowerCase().includes(keyword))
    console.log(`--- "${keyword}" (${matches.length}) ---`)
    console.log(matches.length ? matches.map((m) => `  - ${m}`).join('\n') : '  (لا يوجد)')
  }
  console.log('')

  console.log('=== مقارنة مع MOODLE_WS_TOKEN_PROF ===\n')
  let profFunctions = []
  if (TOKEN_PROF) {
    try {
      profFunctions = ((await callMoodleWs(MOODLE_BASE_URL, TOKEN_PROF, 'core_webservice_get_site_info')).functions || []).map((f) => f.name)
    } catch (err) {
      console.log(`تعذّر جلب قائمة PROF للمقارنة: ${err.message}`)
    }
  } else {
    console.log('MOODLE_WS_TOKEN_PROF غير موجود بـ.env — تخطّي المقارنة.')
  }

  if (profFunctions.length > 0) {
    const profSet = new Set(profFunctions)
    const newSet = new Set(newFunctions)
    const onlyInNew = newFunctions.filter((f) => !profSet.has(f)).sort()
    const onlyInProf = profFunctions.filter((f) => !newSet.has(f)).sort()
    console.log(`متاح في NEW فقط (${onlyInNew.length}):`)
    console.log(onlyInNew.length ? onlyInNew.map((f) => `  - ${f}`).join('\n') : '  (لا يوجد)')
    console.log('')
    console.log(`متاح في PROF فقط (${onlyInProf.length}):`)
    console.log(onlyInProf.length ? onlyInProf.map((f) => `  - ${f}`).join('\n') : '  (لا يوجد)')
  }
  console.log('')

  console.log('=== المرحلة 2: core_course_get_courses (أول 20) ===\n')
  const allCourses = await callMoodleWs(workingBaseUrl, TOKEN_NEW, 'core_course_get_courses', {})
  const realCourses = allCourses.filter((c) => c.id !== 1)
  console.log(`إجمالي المقررات: ${realCourses.length}`)
  for (const c of realCourses.slice(0, 20)) {
    console.log(`  id=${c.id} | "${c.fullname}"`)
  }
  console.log('')

  console.log('=== core_course_search_courses ===\n')
  const foundById = new Map()
  for (const term of SEARCH_TERMS) {
    let results
    try {
      results = (await callMoodleWs(workingBaseUrl, TOKEN_NEW, 'core_course_search_courses', { criterianame: 'search', criteriavalue: term })).courses || []
    } catch (err) {
      console.log(`بحث "${term}" فشل: ${err.message}`)
      continue
    }
    console.log(`"${term}": ${results.length} نتيجة`)
    for (const c of results) {
      foundById.set(c.id, { id: c.id, fullname: c.fullname })
      console.log(`  courseid=${c.id} | "${c.fullname}"`)
    }
  }
  console.log('')

  console.log('=== المرحلة 3: البحث عن رابريك فعلي ===\n')

  // Prioritize search-result courses (more likely relevant), then fall back to the general
  // course list, up to MAX_COURSES_TO_CHECK total.
  const searchResults = [...foundById.values()]
  const remainingSlots = MAX_COURSES_TO_CHECK - searchResults.length
  const otherCourses = realCourses.filter((c) => !foundById.has(c.id)).slice(0, Math.max(0, remainingSlots))
  const coursesToCheck = [...searchResults, ...otherCourses]

  console.log(`سيتم فحص ${coursesToCheck.length} مقرر من إجمالي ${realCourses.length} (حد أقصى ${MAX_COURSES_TO_CHECK}).\n`)

  let found = null
  let checkedCount = 0
  for (const course of coursesToCheck) {
    checkedCount++
    let contents
    try {
      contents = await callMoodleWs(workingBaseUrl, TOKEN_NEW, 'core_course_get_contents', { courseid: course.id })
    } catch (err) {
      console.log(`courseid=${course.id}: core_course_get_contents فشل — ${err.message}`)
      continue
    }
    const assignModules = contents.flatMap((s) => s.modules || []).filter((m) => m.modname === 'assign')
    if (assignModules.length === 0) continue

    console.log(`courseid=${course.id} ("${course.fullname}"): ${assignModules.length} واجب`)
    for (const mod of assignModules) {
      let definitionsResult
      try {
        definitionsResult = await callMoodleWs(workingBaseUrl, TOKEN_NEW, 'core_grading_get_definitions', { 'cmids[0]': mod.id, areaname: 'submissions' })
      } catch (err) {
        console.log(`  cmid=${mod.id} ("${mod.name}"): core_grading_get_definitions فشل — ${err.message}`)
        continue
      }
      const redacted = redactStudentData(definitionsResult)
      const area = redacted.areas?.[0]
      const hasRubric = area && area.activemethod && area.definitions && area.definitions.length > 0
      console.log(`  cmid=${mod.id} ("${mod.name}"): activemethod=${area?.activemethod ?? 'null'}, definitions=${area?.definitions?.length ?? 0}`)
      if (hasRubric) {
        found = { course, cmid: mod.id, assignmentName: mod.name, redactedResult: redacted }
        break
      }
    }
    if (found) break
  }

  console.log(`\nتم فحص ${checkedCount} مقرر.\n`)

  if (!found) {
    console.log('❌ لم يُعثر على أي رابريك فعلي بتوكن NEW ضمن المقررات المفحوصة. توقفت.')
    return
  }

  console.log(`⭐ وُجد رابريك فعلي! courseid=${found.course.id} ("${found.course.fullname}") → "${found.assignmentName}" (cmid=${found.cmid})\n`)
  const area = found.redactedResult.areas[0]
  const definition = area.definitions[0]
  console.log('=== تعريف الرابريك الكامل ===\n')
  console.log(JSON.stringify(found.redactedResult, null, 2))
  console.log('')

  const rubricCriteria = definition.rubric?.criteria || []
  const extractedCriteria = rubricCriteria.map((c) => ({
    id: c.id,
    description: c.description,
    sortorder: c.sortorder,
    levels: (c.levels || []).map((l) => ({ id: l.id, score: l.score, definition: l.definition })),
  }))

  console.log('=== المقارنة مع sustainable-energy-rubric.json ===\n')
  const referenceRubric = JSON.parse(fs.readFileSync(RUBRIC_REFERENCE_PATH, 'utf8'))
  const moodleTexts = extractedCriteria.map((c) => (c.description || '').trim())
  const comparisonRows = []
  let allMatch = true
  for (const refCriterion of referenceRubric.criteria) {
    const exactMatchIndex = moodleTexts.findIndex((t) => t === refCriterion.criterion_text.trim())
    if (exactMatchIndex !== -1) {
      comparisonRows.push({ code: refCriterion.criterion_code, match: 'EXACT', ourText: refCriterion.criterion_text })
    } else {
      allMatch = false
      comparisonRows.push({ code: refCriterion.criterion_code, match: 'NO_EXACT_MATCH', ourText: refCriterion.criterion_text })
    }
  }
  console.log(`عندنا: ${referenceRubric.criteria.length} معيار | Moodle: ${moodleTexts.length} معيار\n`)
  for (const row of comparisonRows) {
    if (row.match === 'EXACT') {
      console.log(`✅ ${row.code}: تطابق حرفي.`)
    } else {
      console.log(`❌ ${row.code}: لا تطابق. عندنا: "${row.ourText}"`)
    }
  }
  if (!allMatch) {
    console.log('\nنصوص Moodle الكاملة:')
    moodleTexts.forEach((t, i) => console.log(`  [${i}] "${t}"`))
  }
  console.log('')
  console.log(allMatch && moodleTexts.length === referenceRubric.criteria.length ? '✅ تطابق كامل 100%.' : '⚠️ يوجد اختلاف — راجع أعلاه.')

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        courseId: found.course.id,
        courseFullname: found.course.fullname,
        assignmentName: found.assignmentName,
        cmid: found.cmid,
        rubricDefinitionName: definition.name,
        extractedCriteria,
        comparisonWithLocalRubric: comparisonRows,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`\nمحفوظ في: ${OUT_PATH}`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
