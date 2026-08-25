// Finds the real "Sustainable Energy" BTEC course on lms.abchorizon.com (the Moodle instance
// the current tokens actually point at — a previous attempt used courseid 373 from a DIFFERENT
// Moodle instance, elearning.abchorizon.com, by mistake), then extracts its rubric definition.
//
// Flow:
//   1. core_course_search_courses for "Sustainable Energy" (falls back to "BTEC"/"U28"/"Energy"
//      if that finds nothing) — prints courseid/fullname/shortname for every match.
//   2. For each course found: core_course_get_contents to find its assign module(s).
//   3. For each assign module: core_grading_get_definitions (cmids[0]=..., areaname=submissions)
//      to check whether it has a real advanced-grading rubric (activemethod != null AND
//      definitions non-empty).
//   4. For whichever module actually has one: extract the criteria, compare against
//      backend/src/knowledge/sustainable-energy-rubric.json, and save (redacted) to
//      backend/eval-data/moodle-rubric-extracted.json.
//
// READ-ONLY: only search/get_contents/get_definitions are called — all "get"/"search"
// functions. assertReadOnlyName() refuses anything with a mutating verb.
//
// PRODUCTION DATA: redactStudentData() strips any key that could carry a student identity or
// grade from every response before it's printed or saved, same as the previous script.
//
// Usage: node src/scripts/discover-and-fetch-rubric.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const RUBRIC_REFERENCE_PATH = path.join(BACKEND_DIR, 'src', 'knowledge', 'sustainable-energy-rubric.json')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-rubric-extracted.json')

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_PROF = process.env.MOODLE_WS_TOKEN_PROF

if (!MOODLE_BASE_URL || !TOKEN_PROF) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN_PROF must both be set in backend/.env.')
  process.exit(1)
}

const SEARCH_TERMS = ['Sustainable Energy', 'BTEC', 'U28', 'Energy']

const MUTATING_VERB_PATTERN = /create|delete|update|save|submit|remove|revert|lock|unlock|start|reveal|enrol/i
function assertReadOnlyName(name) {
  if (MUTATING_VERB_PATTERN.test(name)) {
    throw new Error(`Refusing to call "${name}" — name contains a mutating verb. Aborting for safety.`)
  }
}

async function callMoodleWs(wsfunction, extraParams = {}) {
  assertReadOnlyName(wsfunction)
  const url = `${MOODLE_BASE_URL.replace(/\/+$/, '')}/webservice/rest/server.php`
  const body = new URLSearchParams({
    wstoken: TOKEN_PROF,
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

async function searchCourses(term) {
  const result = await callMoodleWs('core_course_search_courses', { criterianame: 'search', criteriavalue: term })
  return result.courses || []
}

async function main() {
  console.log('=== الخطوة 1: core_course_search_courses على lms.abchorizon.com ===\n')

  const foundById = new Map()
  for (const term of SEARCH_TERMS) {
    let courses
    try {
      courses = await searchCourses(term)
    } catch (err) {
      console.log(`البحث عن "${term}" فشل: ${err.message}`)
      continue
    }
    console.log(`بحث "${term}": ${courses.length} نتيجة`)
    for (const c of courses) {
      foundById.set(c.id, { id: c.id, fullname: c.fullname, shortname: c.shortname })
    }
    if (courses.length > 0 && term === 'Sustainable Energy') break // exact term matched, no need for fallback terms
  }

  const allCourses = [...foundById.values()]
  console.log(`\nإجمالي مقررات فريدة موجودة: ${allCourses.length}\n`)
  for (const c of allCourses) {
    console.log(`  courseid=${c.id} | الاسم الكامل: "${c.fullname}" | الاسم المختصر: "${c.shortname}"`)
  }
  console.log('')

  if (allCourses.length === 0) {
    console.log('لم يُعثر على أي مقرر بأي من الكلمات المفتاحية المجرَّبة. توقفت.')
    return
  }

  console.log('=== الخطوة 2+3: فحص كل مقرر — assign modules + core_grading_get_definitions ===\n')

  const rubricCandidates = []
  for (const course of allCourses) {
    console.log(`--- courseid=${course.id} ("${course.fullname}") ---`)
    let contents
    try {
      contents = await callMoodleWs('core_course_get_contents', { courseid: course.id })
    } catch (err) {
      console.log(`  core_course_get_contents فشل: ${err.message}\n`)
      continue
    }

    const assignModules = []
    for (const section of contents) {
      for (const module of section.modules || []) {
        if (module.modname === 'assign') assignModules.push(module)
      }
    }

    if (assignModules.length === 0) {
      console.log('  لا يوجد أي واجب (assign) بهذا المقرر.\n')
      continue
    }

    for (const mod of assignModules) {
      console.log(`  فحص واجب "${mod.name}" (cmid=${mod.id})...`)
      let definitionsResult
      try {
        definitionsResult = await callMoodleWs('core_grading_get_definitions', {
          'cmids[0]': mod.id,
          areaname: 'submissions',
        })
      } catch (err) {
        console.log(`    core_grading_get_definitions فشل: ${err.message}`)
        continue
      }
      const redacted = redactStudentData(definitionsResult)
      const area = redacted.areas?.[0]
      const hasRubric = area && area.activemethod && area.definitions && area.definitions.length > 0
      console.log(`    activemethod=${area?.activemethod ?? 'null'}, definitions=${area?.definitions?.length ?? 0}`)
      if (hasRubric) {
        console.log('    ⭐ يوجد رابريك فعلي هنا!')
        rubricCandidates.push({ course, cmid: mod.id, assignmentName: mod.name, redactedResult: redacted })
      }
    }
    console.log('')
  }

  console.log('=== ملخص: أي مقرر/واجب فيه رابريك فعلي؟ ===\n')
  if (rubricCandidates.length === 0) {
    console.log('❌ لا يوجد أي واجب، بين كل المقررات المكتشفة، فيه رابريك فعلي (activemethod + definitions). توقفت.')
    return
  }
  for (const c of rubricCandidates) {
    console.log(`  ✅ courseid=${c.course.id} ("${c.course.fullname}") → واجب "${c.assignmentName}" (cmid=${c.cmid})`)
  }
  console.log('')

  // Extract + compare for the first candidate (if more than one, all are reported above but
  // only the first is compared/saved — flag this rather than silently picking one).
  if (rubricCandidates.length > 1) {
    console.log(`ملاحظة: وُجد أكثر من واجب برابريك فعلي (${rubricCandidates.length}). سأستخرج وأقارن أول واحد فقط — أخبرني إذا بدك البقية.\n`)
  }

  const chosen = rubricCandidates[0]
  const area = chosen.redactedResult.areas[0]
  const definition = area.definitions[0]

  console.log(`=== الخطوة 4: استخراج تعريف الرابريك من "${chosen.assignmentName}" (${definition.name}) ===\n`)
  const rubricCriteria = definition.rubric?.criteria || []
  const extractedCriteria = rubricCriteria.map((criterion) => ({
    id: criterion.id,
    description: criterion.description,
    sortorder: criterion.sortorder,
    levels: (criterion.levels || []).map((level) => ({ id: level.id, score: level.score, definition: level.definition })),
  }))

  console.log(`عدد المعايير المستخرجة: ${extractedCriteria.length}\n`)
  for (const c of extractedCriteria) {
    console.log(`--- (sortorder=${c.sortorder}) ---`)
    console.log(`النص: "${c.description}"`)
    console.log(`المستويات: ${c.levels.map((l) => `[score=${l.score}] "${l.definition}"`).join(' | ')}`)
    console.log('')
  }

  console.log('=== الخطوة 5: المقارنة مع sustainable-energy-rubric.json ===\n')
  const referenceRubric = JSON.parse(fs.readFileSync(RUBRIC_REFERENCE_PATH, 'utf8'))
  const moodleTexts = extractedCriteria.map((c) => (c.description || '').trim())

  const comparisonRows = []
  let allMatch = true
  for (const refCriterion of referenceRubric.criteria) {
    const exactMatchIndex = moodleTexts.findIndex((t) => t === refCriterion.criterion_text.trim())
    if (exactMatchIndex !== -1) {
      comparisonRows.push({ code: refCriterion.criterion_code, match: 'EXACT', ourText: refCriterion.criterion_text, moodleText: moodleTexts[exactMatchIndex] })
    } else {
      allMatch = false
      comparisonRows.push({ code: refCriterion.criterion_code, match: 'NO_EXACT_MATCH', ourText: refCriterion.criterion_text, moodleText: null })
    }
  }

  console.log(`عندنا محلياً: ${referenceRubric.criteria.length} معيار | مستخرج من Moodle: ${moodleTexts.length} معيار\n`)
  for (const row of comparisonRows) {
    if (row.match === 'EXACT') {
      console.log(`✅ ${row.code}: تطابق حرفي كامل.`)
    } else {
      console.log(`❌ ${row.code}: لا يوجد تطابق حرفي.`)
      console.log(`   عندنا:  "${row.ourText}"`)
    }
  }
  if (!allMatch || moodleTexts.length !== referenceRubric.criteria.length) {
    console.log('\nنصوص Moodle الكاملة (للمراجعة اليدوية للفروق):')
    moodleTexts.forEach((t, i) => console.log(`  [${i}] "${t}"`))
  }
  console.log('')
  console.log(
    allMatch && moodleTexts.length === referenceRubric.criteria.length
      ? '✅ النتيجة النهائية: تطابق حرفي كامل 100% بين Moodle وملفنا المحلي.'
      : '⚠️ النتيجة النهائية: يوجد اختلاف — راجع التفاصيل أعلاه.',
  )

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        courseId: chosen.course.id,
        courseFullname: chosen.course.fullname,
        assignmentName: chosen.assignmentName,
        cmid: chosen.cmid,
        rubricDefinitionName: definition.name,
        extractedCriteria,
        comparisonWithLocalRubric: comparisonRows,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`\nمحفوظ (منقّى بالكامل من أي بيانات طالب) في: ${OUT_PATH}`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
