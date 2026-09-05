// Authenticated file download: the download endpoint requires the X-Sync-Token header, which a
// plain <a href> can't send, so this fetches the file as a blob and triggers the save via a
// temporary object URL + programmatic click instead.
export async function downloadViaTeacherFetch(teacherFetch, fileUrl, filename) {
  const response = await teacherFetch(
    `/api/sync/files/download?fileUrl=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename)}`,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Could not download the file.')
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}
