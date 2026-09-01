// LTI 1.3 role URIs (IMS Global LIS v2 vocabulary) that qualify someone as a teacher/admin for
// this tool. Course-scoped ("membership#...") and platform/institution-scoped
// ("system/person#...", "institution/person#...") roles are both accepted — a launch carrying
// ANY of these is treated as a teacher launch.
const TEACHER_ROLE_URIS = [
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper',
  'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator',
  'http://purl.imsglobal.org/vocab/lis/v2/system/person#Administrator',
]

// "membership#Learner" (or any role not in the list above) is never sufficient on its own to
// grant teacher access — but its presence also never blocks it. If Moodle sends both Learner
// and a teacher-qualifying role in the same launch, the teacher role wins. So this is simply
// "does any teacher-role URI appear in the array" — Learner's presence/absence doesn't matter
// to the result either way. Roles are compared as full, exact URI strings (LTI sends the
// complete namespaced URI) — no partial/substring matching.
export function isTeacherRole(rolesArray) {
  if (!Array.isArray(rolesArray)) return false
  return rolesArray.some((role) => TEACHER_ROLE_URIS.includes(role))
}
