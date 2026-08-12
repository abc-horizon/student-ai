import path from 'path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

const SHORT_TEXT_WARNING =
  'This file does not appear to contain extractable text. It may be a scanned image. Please upload a version with selectable text.'
const FAILED_EXTRACTION_WARNING = 'Failed to extract text from this file. It may be corrupted.'

async function extractFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function extractFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText({ pageJoiner: '' })
    return result.text
  } finally {
    await parser.destroy()
  }
}

export async function extractText(file) {
  const extension = path.extname(file?.originalname || '').toLowerCase()

  try {
    let text
    if (extension === '.docx') {
      text = await extractFromDocx(file.buffer)
    } else if (extension === '.pdf') {
      text = await extractFromPdf(file.buffer)
    } else {
      return { text: '', warning: FAILED_EXTRACTION_WARNING, warningCode: 'EXTRACTION_FAILED' }
    }

    if (text.trim().length < 50) {
      return { text, warning: SHORT_TEXT_WARNING, warningCode: 'TEXT_NOT_EXTRACTABLE' }
    }

    return { text, warning: null }
  } catch {
    return { text: '', warning: FAILED_EXTRACTION_WARNING, warningCode: 'EXTRACTION_FAILED' }
  }
}
