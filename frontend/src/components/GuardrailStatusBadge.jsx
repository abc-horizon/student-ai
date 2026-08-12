const CONFIRMATIONS = [
  'لم يتم تقديم أي إعادة صياغة أو كتابة بديلة لنص الطالب.',
  'لم يتم إصدار أي درجة أو تقييم نهائي.',
  'لم يتم اتهام الطالب بالسرقة الأدبية أو استخدام الذكاء الاصطناعي.',
  'تم تحليل الملف في الذاكرة فقط، دون تخزينه بشكل دائم.',
]

function GuardrailStatusBadge() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-2 font-semibold text-gray-800">ضوابط الأداة الفعّالة</h3>
      <ul className="space-y-1 text-sm text-gray-700">
        {CONFIRMATIONS.map((confirmation) => (
          <li key={confirmation}>
            <span className="text-green-600">✓</span> {confirmation}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default GuardrailStatusBadge
