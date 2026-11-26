import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import { sendFeedback } from '../lib/api'
import { currentPlatform, isStandalone } from '../lib/pwa'

/**
 * Testers rate JobSwipe (1-5 stars) and say what they think; the team reads
 * it on the admin page. Same as the phone app's card (mobile FeedbackCard).
 * app_version says how they used the site: "installed ios", "browser desktop".
 */
export default function FeedbackCard({ token }: { token: string }) {
  const { t } = useTranslation()
  const [rating, setRating] = useState(0)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      await sendFeedback(token, {
        rating, message: message.trim(), platform: 'web',
        app_version: `${isStandalone() ? 'installed' : 'browser'} ${currentPlatform()}`,
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mobile.loadFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-8 bg-white rounded-3xl shadow-xl shadow-gray-100 p-6 sm:p-8">
      <h2 className="text-lg font-bold text-gray-900 mb-1">{t('mobile.feedbackTitle')}</h2>
      {sent ? (
        <p className="text-brand-700 font-medium mt-3">{t('mobile.feedbackThanks')}</p>
      ) : (
        <form onSubmit={send} className="space-y-4">
          <p className="text-sm text-gray-500">{t('mobile.feedbackHint')}</p>
          <div role="radiogroup" className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t('mobile.stars', { count: n })}
                onClick={() => setRating(n)}
                className="p-1 rounded-lg hover:bg-amber-50"
              >
                <Icon
                  name="star"
                  className={`w-8 h-8 ${n <= rating ? 'text-amber-500 fill-amber-400' : 'text-gray-300'}`}
                />
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="feedback-message" className="block text-sm font-medium text-gray-700 mb-1">
              {t('mobile.feedbackLabel')}
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              rows={3}
              placeholder={t('mobile.feedbackPlaceholder')}
              className="input w-full"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={rating === 0 || sending} className="btn-primary w-full min-h-[48px] disabled:opacity-50">
            {t('mobile.sendFeedback')}
          </button>
        </form>
      )}
    </div>
  )
}
