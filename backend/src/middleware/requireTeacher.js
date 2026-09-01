// The only "teacher" identity this project has today: one shared secret configured via
// SYNC_ADMIN_TOKEN, checked against the X-Sync-Token header (the same mechanism the frontend's
// TeacherLoginPage/TeacherContext already use against /api/sync). This is NOT the LTI-role-based
// `isTeacher` check that may be added later against the LTI `roles` claim — that is a separate,
// still-pending piece of work and would be a different check layered on top of or instead of
// this one.
export function requireTeacher(req, res, next) {
  const configuredToken = process.env.SYNC_ADMIN_TOKEN
  if (!configuredToken) {
    return res.status(503).json({ error: 'SYNC_ADMIN_TOKEN is not configured on the server.' })
  }
  if (req.get('X-Sync-Token') !== configuredToken) {
    return res.status(403).json({ error: 'Invalid or missing X-Sync-Token header.' })
  }
  next()
}
