import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { joinOrg } from '../lib/api'

export default function JoinOrg() {
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
      setError('No invite token found in the link.')
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
        setError(err instanceof Error ? err.message : 'Failed to join organization')
      })
  }, [inviteToken, session, token, role])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-purple-50 px-4">
      <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-10 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Joining organization...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">You're in!</h1>
            <p className="text-gray-500 mb-6">You've successfully joined the organization.</p>
            <button onClick={() => navigate('/team')} className="btn-primary px-6 py-2.5">
              Go to Team
            </button>
          </>
        )}

        {status === 'needsLogin' && (
          <>
            <div className="text-5xl mb-4">🔑</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to join</h1>
            <p className="text-gray-500 mb-6">
              You need to sign in or create an employer account to accept this invite.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate(`/login?redirect=/join?token=${encodeURIComponent(inviteToken)}`)}
                className="btn-primary px-5 py-2.5"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate(`/register?redirect=/join?token=${encodeURIComponent(inviteToken)}`)}
                className="px-5 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Register
              </button>
            </div>
          </>
        )}

        {status === 'needsEmployer' && (
          <>
            <div className="text-5xl mb-4">🏢</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Employer account required</h1>
            <p className="text-gray-500 mb-6">
              Only employer accounts can join organizations. You're currently signed in as a worker.
            </p>
            <button onClick={() => navigate('/feed')} className="btn-primary px-6 py-2.5">
              Back to Feed
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Couldn't join</h1>
            <p className="text-red-600 mb-6">{error}</p>
            <button onClick={() => navigate('/team')} className="btn-primary px-6 py-2.5">
              Go to Team
            </button>
          </>
        )}
      </div>
    </div>
  )
}
