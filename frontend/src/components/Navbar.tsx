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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/feed" className="flex items-center gap-2 font-bold text-lg text-gray-900">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <span className="text-sm">💼</span>
          </div>
          <span>
            Job<span className="text-brand-500">Swipe</span>
          </span>
        </Link>

        {/* Centre links */}
        <div className="flex items-center gap-1">
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
          className="btn-ghost text-sm py-1.5 px-3"
          title="Sign out"
        >
          <span className="hidden sm:inline">Sign out</span>
          <svg
            className="sm:hidden w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
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
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors
         ${isActive
           ? 'bg-brand-50 text-brand-600'
           : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
         }`
      }
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  )
}
