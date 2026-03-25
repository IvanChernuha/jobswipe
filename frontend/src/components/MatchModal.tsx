import { useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'

interface MatchModalProps {
  myName: string
  theirName: string
  matchId: string
  onClose: () => void
}

export default function MatchModal({ myName, theirName, matchId, onClose }: MatchModalProps) {
  const navigate = useNavigate()
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose()
  }

  function goToChat() {
    onClose()
    navigate(`/chat/${matchId}`)
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/50 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-sm mx-4 bg-white rounded-3xl overflow-hidden
                      card-shadow animate-pop-in">
        {/* Gradient header */}
        <div className="bg-gradient-to-br from-brand-400 via-brand-500 to-purple-500 px-8 pt-10 pb-8 text-center">
          {/* Confetti emoji ring */}
          <div className="text-6xl mb-3 animate-bounce">🎉</div>
          <h2 className="text-3xl font-extrabold text-white mb-1">It's a Match!</h2>
          <p className="text-brand-100 text-sm">You and {theirName} both swiped right.</p>
        </div>

        {/* Body */}
        <div className="px-8 py-6 text-center">
          {/* Avatar pair */}
          <div className="flex items-center justify-center gap-3 mb-5">
            <AvatarCircle label={myName} gradient="from-brand-300 to-brand-500" />
            <div className="text-2xl">💙</div>
            <AvatarCircle label={theirName} gradient="from-purple-300 to-purple-500" />
          </div>

          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            Start a conversation now or keep swiping.
          </p>

          <div className="flex flex-col gap-3">
            <button onClick={goToChat} className="btn-primary py-3 text-base w-full">
              Start Chat
            </button>
            <button onClick={onClose} className="btn-ghost py-3 text-sm w-full">
              Keep Swiping
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AvatarCircle({
  label,
  gradient,
}: {
  label: string
  gradient: string
}) {
  const initials = label
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div
      className={`w-16 h-16 rounded-full bg-gradient-to-br ${gradient}
                  flex items-center justify-center shadow-md`}
    >
      <span className="text-xl font-bold text-white">{initials}</span>
    </div>
  )
}
