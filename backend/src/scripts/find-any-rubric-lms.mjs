// Proof-of-concept: does lms.abchorizon.com (the Moodle instance the current tokens actually
// point to) have ANY assignment, in ANY course/subject, with a real advanced-grading rubric
// configured? This is deliberately subject-agnostic — the goal is only to prove the extraction
// method (core_course_get_contents -> core_grading_get_definitions with cmids[0]=...) works
// end-to-end on this Moodle instance, independent of whether the real Sustainable Energy course
// lives here at all (see the conversation this was written for: it very likely lives on the
// OTHER Moodle instance, elearning.abchorizon.com, which no current token is bound to).
//
// Stops at the FIRST course+assignment found with activemethod != null AND a non-empty
// definitions array — this is a feasibility check, not an exhaustive survey.
//
// READ-ONLY: only core_course_get_courses / core_course_get_contents / core_grading_get_definitions
// are called — all "get_" functions. assertReadOnlyName() refuses anything with a mutating verb.
//
// Prints no student data — only course/module/rubric-definition metadata.
//
// Usage: node src/scripts/find-any-rubric-lms.mjs   (run from backend/)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const BACKEND_DIR = path.join(import.meta.dirname, '..', '..')
const OUT_PATH = path.join(BACKEND_DIR, 'eval-data', 'moodle-rubric-sample.json')
const MAX_COURSES_TO_CHECK = 30

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL
const TOKEN_PROF = process.env.MOODLE_WS_TOKEN_PROF

if (!MOODLE_BASE_URL || !TOKEN_PROF) {
  console.error('MOODLE_BASE_URL and MOODLE_WS_TOKEN_PROF must both be set in backend/.env.')
  process.exit(1)
}

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

async function main() {
  console.log('=== core_course_get_courses (lms.abchorizon.com) ===\n')
  const allCourses = await callMoodleWs('core_course_get_courses', {})
  // Exclude the site "course" (id=1, the Moodle front page, not a real course).
  const realCourses = allCourses.filter((c) => c.id !== 1)
  console.log(`إجمالي المقررات على هذا الموودل: ${realCourses.length}`)
  const toCheck = realCourses.slice(0, MAX_COURSES_TO_CHECK)
  console.log(`سيتم فحص أول ${toCheck.length} مقرر فقط.\n`)

  for (const course of toCheck) {
    console.log(`--- courseid=${course.id} ("${course.fullname}") ---`)
    let contents
    try {
      contents = await callMoodleWs('core_course_get_contents', { courseid: course.id })
    } catch (err) {
      console.log(`  core_course_get_contents فشل: ${err.message}`)
      continue
    }

    const assignModules = []
    for (const section of contents) {
      for (const module of section.modules || []) {
        if (module.modname === 'assign') assignModules.push(module)
      }
    }

    if (assignModules.length === 0) {
      console.log('  لا يوجد واجب (assign) بهذا المقرر.')
      continue
    }

    for (const mod of assignModules) {
      let definitionsResult
      try {
        definitionsResult = await callMoodleWs('core_grading_get_definitions', {
          'cmids[0]': mod.id,
          areaname: 'submissions',
        })
      } catch (err) {
        console.log(`  core_grading_get_definitions فشل لـ cmid=${mod.id}: ${err.message}`)
        continue
      }
      const redacted = redactStudentData(definitionsResult)
      const area = redacted.areas?.[0]
      const hasRubric = area && area.activemethod && area.definitions && area.definitions.length > 0
      console.log(`  واجب "${mod.name}" (cmid=${mod.id}): activemethod=${area?.activemethod ?? 'null'}, definitions=${area?.definitions?.length ?? 0}`)

      if (hasRubric) {
        console.log('\n⭐ وُجد رابريك فعلي! توقفت هنا (أول نتيجة، هذا اختبار جدوى وليس مسحاً شاملاً).\n')
        console.log(`المقرر: courseid=${course.id} ("${course.fullname}")`)
        console.log(`الواجب: "${mod.name}" (cmid=${mod.id})\n`)
        console.log('=== بنية التعريف الكاملة (منقّاة بالكامل من أي بيانات طالب) ===\n')
        console.log(JSON.stringify(redacted, null, 2))

        fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
        fs.writeFileSync(
          OUT_PATH,
          JSON.stringify(
            {
              fetchedAt: new Date().toISOString(),
              purpose: 'Proof-of-concept sample — structure only, not necessarily the real Sustainable Energy rubric.',
              courseId: course.id,
              courseFullname: course.fullname,
              assignmentName: mod.name,
              cmid: mod.id,
              rawResponse: redacted,
            },
            null,
            2,
          ),
          'utf8',
        )
        console.log(`\nمحفوظ في: ${OUT_PATH}`)
        return
      }
    }
  }

  console.log(`\n❌ لم يُعثر على أي رابريك فعلي ضمن أول ${toCheck.length} مقرر من إجمالي ${realCourses.length} على lms.abchorizon.com.`)
}

main().catch((err) => {
  console.error('فشل غير متوقع بالسكريبت:', err)
  process.exit(1)
})
