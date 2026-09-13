import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Navbar() {
  const { signOut, role } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm shadow-gray-50">
      <div className="max-w-5xl mx-auto px-2 sm:px-6 h-14 flex items-center justify-between gap-1">
        {/* Logo — wordmark hidden on phones so six nav items fit at 360px */}
        <Link to="/feed" className="flex items-center gap-2 font-bold text-lg text-gray-900 shrink-0" aria-label="JobSwipe home">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <span className="text-sm">💼</span>
          </div>
          <span className="hidden md:inline">
            Job<span className="text-brand-500">Swipe</span>
          </span>
        </Link>

        {/* Centre links: icon + small label on phones, icon + text on desktop */}
        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
          <NavItem to="/feed" label="Feed" icon="🔍" />
          {role === 'employer' && <NavItem to="/jobs" label="Jobs" icon="📋" />}
          {role === 'employer' && <NavItem to="/team" label="Team" icon="👥" />}
          <NavItem to="/saved" label="Saved" icon="&#x2691;" />
          <NavItem to="/matches" label="Matches" icon="💙" />
          <NavItem to="/profile" label="Profile" icon={role === 'employer' ? '🏢' : '👤'} />
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="btn-ghost text-sm py-1.5 px-2 sm:px-3 shrink-0"
          title="Sign out"
          aria-label="Sign out"
        >
          <span className="hidden sm:inline">Sign out</span>
          <svg className="sm:hidden w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </nav>
  )
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        `flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1.5
         min-w-[44px] min-h-[44px] px-1.5 sm:px-3 py-0.5 sm:py-1.5 rounded-xl
         text-[10px] sm:text-sm font-medium leading-tight transition-colors
         ${isActive
           ? 'bg-brand-50 text-brand-600'
           : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
         }`
      }
    >
      <span className="text-base sm:text-sm leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}
