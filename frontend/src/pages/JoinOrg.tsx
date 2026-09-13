import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { joinOrg } from '../lib/api'

export default function JoinOrg() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token') ?? ''
  const { session, role } = useAuth()
  const navigate = useNavigate()
  const token = session?.access_token ?? ''

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'needsLogin' | 'needsEmployer'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!inviteToken) {
      setStatus('error')
      setError(t('joinOrg.noToken'))
      return
    }

    if (!session) {
      setStatus('needsLogin')
      return
    }

    if (role !== 'employer') {
      setStatus('needsEmployer')
      return
    }

    // Try to join
    joinOrg(token, inviteToken)
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error')
        setError(err instanceof Error ? err.message : t('joinOrg.failedToJoin'))
      })
  }, [inviteToken, session, token, role])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-purple-50 px-4">
      <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-10 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">{t('joinOrg.joining')}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('joinOrg.youreIn')}</h1>
            <p className="text-gray-500 mb-6">{t('joinOrg.joinedSuccess')}</p>
            <button onClick={() => navigate('/team')} className="btn-primary px-6 py-2.5">
              {t('joinOrg.goToTeam')}
            </button>
          </>
        )}

        {status === 'needsLogin' && (
          <>
            <div className="text-5xl mb-4">🔑</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('joinOrg.signInToJoin')}</h1>
            <p className="text-gray-500 mb-6">
              {t('joinOrg.signInHint')}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate(`/login?redirect=/join?token=${encodeURIComponent(inviteToken)}`)}
                className="btn-primary px-5 py-2.5"
              >
                {t('common.signIn')}
              </button>
              <button
                onClick={() => navigate(`/register?redirect=/join?token=${encodeURIComponent(inviteToken)}`)}
                className="px-5 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                {t('joinOrg.register')}
              </button>
            </div>
          </>
        )}

        {status === 'needsEmployer' && (
          <>
            <div className="text-5xl mb-4">🏢</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('joinOrg.employerRequired')}</h1>
            <p className="text-gray-500 mb-6">
              {t('joinOrg.employerRequiredHint')}
            </p>
            <button onClick={() => navigate('/feed')} className="btn-primary px-6 py-2.5">
              {t('joinOrg.backToFeed')}
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('joinOrg.couldNotJoin')}</h1>
            <p className="text-red-600 mb-6">{error}</p>
            <button onClick={() => navigate('/team')} className="btn-primary px-6 py-2.5">
              {t('joinOrg.goToTeam')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
