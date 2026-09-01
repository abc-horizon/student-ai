# BTEC / Zoho integration notes

Reference notes from reading `local_moodle_zoho_sync` (read-only source supplied by the
project supervisor — the plugin itself is not part of this repo, no server access). Nothing
here is wired into the tool; it's a map for a future integration decision.

## 1. Output shape used by the university system

The Zoho sync plugin represents each learning outcome result as:

```json
{
  "code": "P1",
  "level": "PASS",
  "description": "Describe the sources and uses of oil, coal and natural gas.",
  "score": 1,
  "feedback": "...",
  "achieved": true
}
```

### Proposal (not implemented) — mapping our report onto this shape

Our current `criteriaCoverage` item looks like:

```json
{ "id": 3, "name": "Task Achievement", "status": "Partially Covered", "comment": "..." }
```

These don't line up 1:1 — ours is 14 generic criteria with a 3-state status; theirs is a
per-BTEC-criterion (P1-P6/M1-M3/D1-D3) pass/fail with a numeric score. Two ways to close the
gap, in increasing order of effort:

- **Adapter at the report boundary**: keep `criteriaCoverage` exactly as-is (no prompt or
  analysis change), and add a separate output field that re-expresses each item using the
  external shape for whichever consumer needs it — `code` ← our `id`, `level` derived from a
  fixed status→level mapping (e.g. `Fully Covered` → `PASS`-equivalent `achieved: true`),
  `description` ← `name`, `feedback` ← `comment`, `score` left `null` (we don't produce a
  numeric score and shouldn't invent one — see the estimator's disclaimer requirement).
  Low effort, but `code`/`level` would be synthetic, not real BTEC criterion codes, since our
  14 criteria aren't the same 12 P/M/D criteria Zoho tracks.
- **Criteria-set alignment**: change what the AI evaluates so criteriaCoverage is generated
  directly against the unit's real P1-P6/M1-M3/D1-D3 criteria (as already loaded per-unit in
  `sustainable-energy-rubric.json`, one file per BTEC unit) instead of the generic 14. This
  would produce genuinely comparable `code`/`level`/`achieved` values and let
  `estimateBtecLevel()` (see `backend/src/services/btecGradeEstimator.js`) run on real
  per-report data instead of only eval-time. This is the version that would need a
  prompt/analysis change, and is explicitly out of scope for now per your instruction not to
  touch current analysis logic — flagging it here only as the direction, pending your call.

## 2. Where BTEC criteria actually live in Moodle

- `gradingform_btec_criteria` (`definitionid`, `shortname`, `description`,
  `descriptionformat`, `sortorder`) — the criteria definitions themselves.
- `gradingform_btec_fillings` (`instanceid`, `criterionid`, `score`, `remark`) — one row per
  student per criterion: the actual grade.
- `local_mzi_btec_templates` (`definition_id`, `zoho_unit_id`, `unit_name`, `synced_at`) — the
  plugin's own mapping table linking a Moodle grading definition to a Zoho unit.

## 3. Why this isn't reachable over the Moodle web service API today

`gradingform_btec` is a separate plugin with its own tables. The standard Moodle web service
function `core_grading_get_definitions` only reads the generic `grading_definitions` table —
it has no knowledge of `gradingform_btec_criteria`.

The plugin *does* contain a function that reads the BTEC criteria —
`data_extractor.php::extract_btec_learning_outcomes` — but it was never registered as a web
service. `db/services.php` registers 20+ functions; exactly one is marked
`'type' => 'read'` (`local_mzi_get_moodle_ids`), and none of them expose criteria reads. So the
read path exists in code but has no API surface to call it through.

## 4. Ready-to-run query, if DB access is available in the future

```sql
SELECT t.unit_name, t.zoho_unit_id, c.shortname, c.description, c.sortorder
FROM {local_mzi_btec_templates} t
JOIN {gradingform_btec_criteria} c ON c.definitionid = t.definition_id
ORDER BY t.unit_name, c.sortorder;
```

## 5. Architectural conclusion

Zoho is the system of record for BTEC criteria, not Moodle. Moodle's `gradingform_btec_*`
tables hold the per-student gradings, but the canonical criteria definitions and their mapping
to units live on the Zoho side (`local_mzi_btec_templates` only stores a pointer —
`zoho_unit_id` — not the criteria content). Any future integration should treat Zoho as the
source of truth to read from, and Moodle as where per-student results get written back to.
