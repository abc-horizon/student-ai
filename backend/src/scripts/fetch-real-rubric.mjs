// Fetches the REAL BTEC rubric definition for course 373 ("2526T2 L3 U28 Sustainable Energy"),
// assignment "Sustainable Energy Assignment 2526T2" — confirmed by the project owner to have an
// advanced-grading rubric ("Sustainable Energy Ready for use") actually configured, unlike the
// pilot course 513 tested earlier. Compares the extracted criteria against
// backend/src/knowledge/sustainable-energy-rubric.json.
//
// READ-ONLY: only core_course_get_contents and core_grading_get_definitions are called. Both
// are "get_" functions; assertReadOnlyName() below refuses anything with a mutating verb.
//
// PRODUCTION COURSE WITH REAL STUDENTS — student-data handling is stricter here than in the
// earlier pilot-course exploration:
//   - redactStudentData() strips any key that could carry a student's identity or a grade
//     (see REDACT_KEY_PATTERN) from the raw Moodle response before it is EVER printed or
//     written to disk. Only the redacted version is used from that point on.
//   - core_grading_get_definitions returns grading-form DEFINITIONS (criteria/levels), which
//     are course-level data, not per-student "fillings" — but the redaction step runs
//     regardless, as defense in depth, in case the response includes anything unexpected.
//
// Usage: node src/scripts/fetch-real-rubric.mjs   (run from backend/)

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

const REAL_COURSE_ID = 373
const TARGET_ASSIGNMENT_NAME = 'Sustainable Energy Assignment 2526T2'

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

// Same redaction used for the earlier real-course-adjacent probe: drop any key that could carry
// a student's identity or grade, recursively, regardless of depth.
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
  console.log(`=== الخطوة 1: core_course_get_contents (course ${REAL_COURSE_ID}) ===\n`)

  const contents = await callMoodleWs('core_course_get_contents', { courseid: REAL_COURSE_ID })
  let targetModule = null
  for (const section of contents) {
    for (const module of section.modules || []) {
      if (module.modname === 'assign' && module.name === TARGET_ASSIGNMENT_NAME) {
        targetModule = module
      }
    }
  }

  if (!targetModule) {
    console.log(`لم يُعثر على واجب باسم "${TARGET_ASSIGNMENT_NAME}" بالمقرر ${REAL_COURSE_ID}. توقفت.`)
    console.log('أسماء الواجبات (assign) الموجودة فعلياً بهذا المقرر:')
    for (const section of contents) {
      for (const module of section.modules || []) {
        if (module.modname === 'assign') console.log(`  - "${module.name}" (cmid=${module.id})`)
      }
    }
    return
  }

  console.log(`لُقي: cmid=${targetModule.id}, contextid=${targetModule.contextid}\n`)

  console.log('=== الخطوة 2: core_grading_get_definitions (cmids[0]=' + targetModule.id + ', areaname=submissions) ===\n')

  let rawResult
  try {
    rawResult = await callMoodleWs('core_grading_get_definitions', {
      'cmids[0]': targetModule.id,
      areaname: 'submissions',
    })
  } catch (err) {
    console.log(`رسالة الخطأ الحرفية: "${err.message}"${err.errorcode ? ` (errorcode: ${err.errorcode})` : ''}`)
    console.log('توقفت — لم يُستخرج أي تعريف.')
    return
  }

  const redactedResult = redactStudentData(rawResult)
  console.log('✅ نجح الاستدعاء. الاستجابة (بعد تنقية كاملة من أي بيانات طالب):\n')
  console.log(JSON.stringify(redactedResult, null, 2))
  console.log('')

  const area = redactedResult.areas?.[0]
  if (!area || !area.definitions || area.definitions.length === 0) {
    console.log('لا يوجد أي رابريك مُعرَّف فعلياً بهذا الواجب حسب الاستجابة — توقفت (لا شيء لمقارنته).')
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
    fs.writeFileSync(OUT_PATH, JSON.stringify(redactedResult, null, 2), 'utf8')
    return
  }

  console.log(`=== الخطوة 3: استخراج تعريف الرابريك (${area.activemethod}) ===\n`)
  const definition = area.definitions[0]
  console.log(`اسم النموذج: "${definition.name}"`)
  console.log(`الوصف: ${definition.description || '(بدون)'}`)
  console.log('')

  // Rubric definitions (gradingform_rubric) come back with definition.rubric.criteria, each
  // criterion having .description and a nested .levels array (score + definition text).
  const rubricCriteria = definition.rubric?.criteria || []
  console.log(`عدد المعايير المستخرجة من Moodle: ${rubricCriteria.length}\n`)

  const extractedCriteria = rubricCriteria.map((criterion) => ({
    id: criterion.id,
    description: criterion.description,
    sortorder: criterion.sortorder,
    levels: (criterion.levels || []).map((level) => ({ id: level.id, score: level.score, definition: level.definition })),
  }))

  for (const c of extractedCriteria) {
    console.log(`--- معيار (sortorder=${c.sortorder}) ---`)
    console.log(`النص: "${c.description}"`)
    console.log(`المستويات: ${c.levels.map((l) => `[score=${l.score}] "${l.definition}"`).join(' | ')}`)
    console.log('')
  }

  console.log('=== الخطوة 4: المقارنة مع sustainable-energy-rubric.json ===\n')
  const referenceRubric = JSON.parse(fs.readFileSync(RUBRIC_REFERENCE_PATH, 'utf8'))

  // Moodle rubric criteria don't carry a "P1"/"M2"/"D3" code natively — they're just ordered
  // descriptions. We match by exact text first; if that fails, report the raw texts side by
  // side so a human can judge whether it's a wording difference or a structural one (e.g. the
  // 12 official criteria packaged differently than 12 separate rubric rows).
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

  console.log(`عدد المعايير عندنا محلياً: ${referenceRubric.criteria.length}`)
  console.log(`عدد المعايير المستخرجة من Moodle: ${moodleTexts.length}`)
  console.log('')

  for (const row of comparisonRows) {
    if (row.match === 'EXACT') {
      console.log(`✅ ${row.code}: تطابق حرفي كامل.`)
    } else {
      console.log(`❌ ${row.code}: لا يوجد تطابق حرفي.`)
      console.log(`   عندنا:   "${row.ourText}"`)
      console.log(`   الأقرب بموودل (إن وُجد، غير مؤكد المطابقة):`)
      for (const t of moodleTexts) console.log(`     - "${t}"`)
    }
  }
  console.log('')

  if (allMatch && moodleTexts.length === referenceRubric.criteria.length) {
    console.log('✅ النتيجة النهائية: كل الـ12 معيار متطابقة حرفياً 100% بين Moodle وملفنا المحلي.')
  } else {
    console.log('⚠️ النتيجة النهائية: يوجد اختلاف — راجع التفاصيل أعلاه (قد يكون فرق ترتيب/تقسيم وليس بالضرورة فرق محتوى).')
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        courseId: REAL_COURSE_ID,
        assignmentName: TARGET_ASSIGNMENT_NAME,
        cmid: targetModule.id,
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
