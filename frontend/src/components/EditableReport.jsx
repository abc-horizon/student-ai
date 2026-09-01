const INPUT_CLASS = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
const REMOVE_BUTTON_CLASS = 'shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50'
const ADD_BUTTON_CLASS = 'mt-2 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50'

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="mb-4 border-b border-gray-100 pb-3 text-base font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

function StringListEditor({ items, onChange, placeholder }) {
  function updateAt(index, value) {
    const next = [...items]
    next[index] = value
    onChange(next)
  }
  function removeAt(index) {
    onChange(items.filter((_, i) => i !== index))
  }
  function add() {
    onChange([...items, ''])
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <textarea
            value={item}
            onChange={(e) => updateAt(index, e.target.value)}
            placeholder={placeholder}
            rows={2}
            className={INPUT_CLASS}
          />
          <button type="button" onClick={() => removeAt(index)} className={REMOVE_BUTTON_CLASS}>
            Delete
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className={ADD_BUTTON_CLASS}>
        + Add
      </button>
    </div>
  )
}

function EditableReport({ report, onChange }) {
  function set(field, value) {
    onChange({ ...report, [field]: value })
  }

  function updateCriterion(index, patch) {
    const next = [...report.criteriaCoverage]
    next[index] = { ...next[index], ...patch }
    set('criteriaCoverage', next)
  }

  function updateIssueList(field, index, patch) {
    const next = [...report[field]]
    next[index] = { ...next[index], ...patch }
    set(field, next)
  }
  function removeIssue(field, index) {
    set(field, report[field].filter((_, i) => i !== index))
  }

  function updateReviewerNote(key, value) {
    set('reviewerNotes', { ...report.reviewerNotes, [key]: value })
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Executive Summary">
        <textarea
          value={report.executiveSummary}
          onChange={(e) => set('executiveSummary', e.target.value)}
          rows={4}
          className={INPUT_CLASS}
        />
      </Section>

      <Section title="Strengths">
        <StringListEditor items={report.strengths} onChange={(v) => set('strengths', v)} placeholder="Strength" />
      </Section>

      <Section title="Criteria Coverage (14 Criteria)">
        <div className="space-y-4">
          {[...report.criteriaCoverage]
            .sort((a, b) => a.id - b.id)
            .map((item) => {
              const index = report.criteriaCoverage.findIndex((c) => c.id === item.id)
              return (
                <div key={item.id} className="rounded-lg border border-gray-100 p-3">
                  <p className="mb-2 text-sm font-semibold text-gray-800">
                    {item.id}. {item.name}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={item.status}
                      onChange={(e) => updateCriterion(index, { status: e.target.value })}
                      className={`${INPUT_CLASS} sm:w-56`}
                    >
                      <option value="Fully Covered">Fully Covered</option>
                      <option value="Partially Covered">Partially Covered</option>
                      <option value="Not Covered">Not Covered</option>
                    </select>
                    <textarea
                      value={item.comment}
                      onChange={(e) => updateCriterion(index, { comment: e.target.value })}
                      rows={2}
                      className={`${INPUT_CLASS} flex-1`}
                    />
                  </div>
                </div>
              )
            })}
        </div>
      </Section>

      <Section title="Critical Issues">
        <div className="space-y-3">
          {report.criticalIssues.map((issue, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
              <textarea
                value={issue.issue}
                onChange={(e) => updateIssueList('criticalIssues', index, { issue: e.target.value })}
                placeholder="Issue description"
                rows={2}
                className={INPUT_CLASS}
              />
              <input
                value={issue.location}
                onChange={(e) => updateIssueList('criticalIssues', index, { location: e.target.value })}
                placeholder="Location"
                className={INPUT_CLASS}
              />
              <textarea
                value={issue.requiredAction}
                onChange={(e) => updateIssueList('criticalIssues', index, { requiredAction: e.target.value })}
                placeholder="Required action"
                rows={2}
                className={INPUT_CLASS}
              />
              <button type="button" onClick={() => removeIssue('criticalIssues', index)} className={REMOVE_BUTTON_CLASS}>
                Delete this issue
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('criticalIssues', [...report.criticalIssues, { issue: '', location: '', requiredAction: '' }])}
            className={ADD_BUTTON_CLASS}
          >
            + Add critical issue
          </button>
        </div>
      </Section>

      <Section title="Important Issues">
        <div className="space-y-3">
          {report.importantIssues.map((issue, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
              <textarea
                value={issue.issue}
                onChange={(e) => updateIssueList('importantIssues', index, { issue: e.target.value })}
                placeholder="Issue description"
                rows={2}
                className={INPUT_CLASS}
              />
              <textarea
                value={issue.suggestedAction}
                onChange={(e) => updateIssueList('importantIssues', index, { suggestedAction: e.target.value })}
                placeholder="Suggestion"
                rows={2}
                className={INPUT_CLASS}
              />
              <button type="button" onClick={() => removeIssue('importantIssues', index)} className={REMOVE_BUTTON_CLASS}>
                Delete this issue
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('importantIssues', [...report.importantIssues, { issue: '', suggestedAction: '' }])}
            className={ADD_BUTTON_CLASS}
          >
            + Add important issue
          </button>
        </div>
      </Section>

      <Section title="Top Priority Actions Before Submission">
        <StringListEditor
          items={report.topPriorityActions}
          onChange={(v) => set('topPriorityActions', v)}
          placeholder="Action"
        />
      </Section>

      <Section title="Reviewer Notes">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Content & Scientific Accuracy Reviewer</label>
            <textarea
              value={report.reviewerNotes.contentAccuracy}
              onChange={(e) => updateReviewerNote('contentAccuracy', e.target.value)}
              rows={2}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Evidence & Sources Reviewer</label>
            <textarea
              value={report.reviewerNotes.evidenceSources}
              onChange={(e) => updateReviewerNote('evidenceSources', e.target.value)}
              rows={2}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Clarity, Structure & Integrity Reviewer</label>
            <textarea
              value={report.reviewerNotes.clarityIntegrity}
              onChange={(e) => updateReviewerNote('clarityIntegrity', e.target.value)}
              rows={2}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Points of disagreement between reviewers (optional)</label>
            <textarea
              value={report.reviewerNotes.disagreements}
              onChange={(e) => updateReviewerNote('disagreements', e.target.value)}
              rows={2}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </Section>
    </div>
  )
}

export default EditableReport
