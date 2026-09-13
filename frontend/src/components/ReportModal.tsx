import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { submitReport, blockUser, type ReportReason } from '../lib/api'

const REASON_VALUES: ReportReason[] = ['spam', 'inappropriate', 'fake', 'harassment', 'other']
const REASON_LABEL_KEYS: Record<ReportReason, string> = {
  spam: 'report.reasons.spam',
  inappropriate: 'report.reasons.inappropriate',
  fake: 'report.reasons.fake',
  harassment: 'report.reasons.harassment',
  other: 'report.reasons.other',
}

export default function ReportModal({
  targetId,
  targetType,
  token,
  onClose,
  onBlocked,
}: {
  targetId: string
  targetType: 'user' | 'job'
  token: string
  onClose: () => void
  /** Called once the target user has been blocked (only for targetType 'user'). */
  onBlocked?: () => void
}) {
  const { t } = useTranslation()
  const canBlock = targetType === 'user'
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [block, setBlock] = useState(canBlock)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitReport(token, targetId, targetType, reason, details)
      if (canBlock && block) {
        await blockUser(token, targetId)
        setBlocked(true)
        onBlocked?.()
      }
      setDone(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('409')) {
        setError(t('report.alreadyReported'))
      } else {
        setError(t('report.submitFailed'))
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
            <h2 className="text-lg font-bold text-gray-900 mb-2">{blocked ? t('report.reportedAndBlocked') : t('report.reportSubmitted')}</h2>
            <p className="text-sm text-gray-500 mb-4">
              {blocked
                ? t('report.blockedThankYou')
                : t('report.submittedThankYou')}
            </p>
            <button onClick={onClose} className="btn-primary text-sm py-2 px-6">{t('common.done')}</button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {targetType === 'job' ? t('report.reportJobPosting') : t('report.reportUser')}
            </h2>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">{t('report.reason')}</label>
                <div className="space-y-2">
                  {REASON_VALUES.map((value) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="reason"
                        value={value}
                        checked={reason === value}
                        onChange={() => setReason(value)}
                        className="text-brand-500 focus:ring-brand-300"
                      />
                      <span className="text-sm text-gray-700">{t(REASON_LABEL_KEYS[value])}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('report.detailsOptional')}</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder={t('report.detailsPlaceholder')}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </div>

              {canBlock && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={block}
                    onChange={(e) => setBlock(e.target.checked)}
                    className="mt-0.5 text-brand-500 focus:ring-brand-300"
                  />
                  <span className="text-sm text-gray-700">
                    {t('report.alsoBlock')}
                    <span className="block text-xs text-gray-400">{t('report.blockHint')}</span>
                  </span>
                </label>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={submitting} className="flex-1 btn-primary py-2.5 text-sm bg-red-500 hover:bg-red-600">
                  {submitting ? t('report.submitting') : canBlock && block ? t('report.reportAndBlock') : t('report.submitReport')}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
