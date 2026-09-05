const CONFIRMATIONS = [
  "No rewritten or alternative version of the student's text was provided.",
  'No grade or final evaluation was issued.',
  'The student was not accused of plagiarism or of using AI.',
  "The original file and its full text were not kept; a review report — including short excerpts of the student's writing — was saved so the teacher can access it.",
]

function GuardrailStatusBadge() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Active Tool Safeguards</h3>
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
