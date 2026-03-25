import { useState } from 'react'
import { submitReport, type ReportReason } from '../lib/api'

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'fake', label: 'Fake profile / job' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'other', label: 'Other' },
]

export default function ReportModal({
  targetId,
  targetType,
  token,
  onClose,
}: {
  targetId: string
  targetType: 'user' | 'job'
  token: string
  onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitReport(token, targetId, targetType, reason, details)
      setDone(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('409')) {
        setError('You have already reported this.')
      } else {
        setError('Failed to submit report. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-pop-in" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-4">
            <p className="text-3xl mb-3">&#10003;</p>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Report Submitted</h2>
            <p className="text-sm text-gray-500 mb-4">Thank you. We'll review this shortly.</p>
            <button onClick={onClose} className="btn-primary text-sm py-2 px-6">Done</button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Report {targetType === 'job' ? 'Job Posting' : 'User'}
            </h2>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Reason</label>
                <div className="space-y-2">
                  {REASONS.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                        className="text-brand-500 focus:ring-brand-300"
                      />
                      <span className="text-sm text-gray-700">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Details (optional)</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="Tell us more about the issue..."
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 btn-primary py-2.5 text-sm bg-red-500 hover:bg-red-600">
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
