import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import LangToggle from '../components/LangToggle'
import type { Role } from '../lib/api'

export default function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const rawRole = searchParams.get('role')
  const defaultRole: Role = rawRole === 'employer' ? 'employer' : 'worker'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(defaultRole)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Sign up via Supabase — pass role in user_metadata so context can read it
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role },
        },
      })

      if (signUpError) throw new Error(signUpError.message)

      navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-purple-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 p-8 sm:p-10">
          <div className="flex justify-end mb-3"><LangToggle /></div>
          {/* Header */}
          <div className="text-center mb-8">
            <Link to="/" className="inline-block mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mx-auto shadow-md shadow-brand-200">
                <span className="text-2xl">💼</span>
              </div>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{t('register.title')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t('register.subtitle')}</p>
          </div>

          {error && (
            <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
              {/already registered|already exists/i.test(error) && (
                <>
                  {' '}
                  <Link to="/login" className="font-semibold underline">{t('register.signInInstead')}</Link>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Role toggle */}
            <div>
              <p className="label">{t('register.iAmA')}</p>
              <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                {(['worker', 'employer'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-2 rounded-lg text-sm font-medium transition-all ${
                      role === r
                        ? 'bg-white shadow-sm text-brand-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {r === 'worker' ? `👷 ${t('register.worker')}` : `🏢 ${t('register.employer')}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="email" className="label">
                {t('common.emailAddress')}
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="label">
                {t('common.password')}
                <span className="ms-1 text-xs font-normal text-gray-400">{t('register.minChars', { count: 8 })}</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base mt-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('register.creatingAccount')}
                </span>
              ) : (
                t('register.createAccount')
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            {t('landing.haveAccount')}{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:underline">
              {t('common.signIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
