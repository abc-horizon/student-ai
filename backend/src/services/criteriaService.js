// Real BTEC assessment criteria (P/M/D), sourced from Zoho's data (the system of record — see
// backend/eval-data/btec-integration-notes.md) and stored as one static JSON file per unit in
// src/knowledge/. This exists because BTEC criteria are NOT retrievable through any Moodle web
// service function on this instance: `core_grading_*` fails uniformly regardless of parameters
// (confirmed live against elearning.abchorizon.com — every combination of contextids/component/
// area/areaname for core_grading_get_definitions and even core_grading_save_definitions returns
// the identical generic invalid_parameter_exception, while unrelated functions using the same
// request shape work fine, meaning that function family is broken/blocked on this instance, not
// a parameter-guessing problem), and the only BTEC-specific web service functions registered are
// local_mzi_create_btec_definition / local_moodle_zoho_sync_create_btec_definition (create) and
// local_mzi_delete_btec_definition (delete) — no read function exists at all.
//
// A course is matched to its rubric file by PROGRAM + unit number together, not unit number
// alone — Moodle course fullnames follow the pattern "<term> <program> U<unit number> <title>"
// (e.g. "2526T2 L3 U28 Sustainable Energy", "2526T2 IT U10 Cyber Security"), and unit numbers are
// NOT unique across programs (e.g. "IT U10" = Cyber Security, "BUS U10" = Recording financial
// transactions are two entirely different units that happen to share the number 10). Matching on
// number alone would silently show the wrong subject's criteria for one of them. Each rubric
// file's unit.program + unit.number are compared as an adjacent "<program> U<number>" substring.
// Adding a new unit's criteria later is just dropping in another *-rubric.json file here — no
// code change needed.

import fs from 'fs'
import path from 'path'

const KNOWLEDGE_DIR = path.join(import.meta.dirname, '..', 'knowledge')

let cachedRubrics = null

function loadRubrics() {
  if (cachedRubrics) return cachedRubrics

  cachedRubrics = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((file) => file.endsWith('-rubric.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8')))
    .filter((rubric) => rubric?.unit?.number && rubric?.unit?.program)

  return cachedRubrics
}

export function getCriteriaForCourseName(courseFullname) {
  if (!courseFullname) return null

  const rubrics = loadRubrics()
  const unitPattern = (program, number) =>
    new RegExp(`\\b${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+U${number}\\b`, 'i')

  return rubrics.find((rubric) => unitPattern(rubric.unit.program, rubric.unit.number).test(courseFullname)) || null
}
