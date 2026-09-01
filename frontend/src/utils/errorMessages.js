const ERROR_MESSAGES = {
  USAGE_LIMIT_EXCEEDED: 'This tool has already been used for this assignment. It can only be used once per assignment.',
  INVALID_LAUNCH_TOKEN: 'Your Moodle login session has expired. Please go back to the assignment in Moodle and open the tool again.',
  FILE_MISSING: 'No file was attached.',
  UNSUPPORTED_FILE_TYPE: 'Unsupported file format. Accepted formats: .docx, .pdf.',
  FILE_TOO_LARGE: 'The file exceeds the maximum allowed size (15 MB).',
  FILE_CORRUPTED: 'The file is corrupted or unreadable.',
  FILE_COUNT_INVALID: 'The number of attached files is invalid.',
  TEXT_NOT_EXTRACTABLE:
    'Could not extract text from this file. It may be a scanned image. Please upload a version with selectable text.',
  EXTRACTION_FAILED: 'Could not extract text from this file. It may be corrupted.',
  AI_SERVICE_ERROR: 'An error occurred while the AI was analyzing the assignment. Please try again later.',
  REPORT_VALIDATION_FAILED: 'An error occurred while preparing the report. Please try again later.',
  AI_CONFIG_INVALID:
    "The tool's AI settings are currently misconfigured and need to be fixed by an administrator before this tool can be used. Please let your instructor know.",
}

const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.'

export function getErrorMessage(errorCode) {
  return ERROR_MESSAGES[errorCode] || GENERIC_ERROR_MESSAGE
}
