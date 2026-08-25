const ERROR_MESSAGES = {
  USAGE_LIMIT_EXCEEDED: 'تم استخدام هذه الأداة مسبقًا لهذا الواجب. لا يمكن استخدامها إلا مرة واحدة لكل واجب.',
  INVALID_LAUNCH_TOKEN: 'انتهت صلاحية جلسة الدخول من موودل. يرجى العودة إلى الواجب بموودل وفتح الأداة من جديد.',
  FILE_MISSING: 'لم يتم إرفاق أي ملف.',
  UNSUPPORTED_FILE_TYPE: 'صيغة الملف غير مدعومة. الصيغ المقبولة: .docx، .pdf.',
  FILE_TOO_LARGE: 'حجم الملف يتجاوز الحد الأقصى المسموح (15 ميجابايت).',
  FILE_CORRUPTED: 'الملف تالف أو غير قابل للقراءة.',
  FILE_COUNT_INVALID: 'عدد الملفات المرفقة غير صحيح.',
  TEXT_NOT_EXTRACTABLE:
    'تعذّر استخراج نص من هذا الملف. قد يكون صورة ممسوحة ضوئيًا. يرجى رفع نسخة تحتوي على نص قابل للتحديد.',
  EXTRACTION_FAILED: 'تعذّر استخراج النص من هذا الملف. قد يكون تالفًا.',
  AI_SERVICE_ERROR: 'حدث خطأ أثناء تحليل الواجب بواسطة الذكاء الاصطناعي. يرجى المحاولة مرة أخرى لاحقًا.',
  REPORT_VALIDATION_FAILED: 'حدث خطأ أثناء إعداد التقرير. يرجى المحاولة مرة أخرى لاحقًا.',
}

const GENERIC_ERROR_MESSAGE = 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'

export function getArabicErrorMessage(errorCode) {
  return ERROR_MESSAGES[errorCode] || GENERIC_ERROR_MESSAGE
}
