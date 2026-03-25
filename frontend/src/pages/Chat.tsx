import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getMessages, sendMessage, getMatch } from '../lib/api'
import type { Message, Match } from '../lib/api'

export default function Chat() {
  const { matchId } = useParams<{ matchId: string }>()
  const { session, role } = useAuth()
  const navigate = useNavigate()
  const token = session?.access_token ?? ''

  const [messages, setMessages] = useState<Message[]>([])
  const [matchInfo, setMatchInfo] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load match info + messages
  useEffect(() => {
    if (!token || !matchId) return

    setLoading(true)
    Promise.all([
      getMatch(token, matchId),
      getMessages(token, matchId),
    ])
      .then(([m, msgs]) => {
        setMatchInfo(m)
        setMessages(msgs)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load chat')
      })
      .finally(() => setLoading(false))
  }, [token, matchId])

  // Scroll on new messages
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Poll for new messages every 3 seconds
  useEffect(() => {
    if (!token || !matchId) return

    pollRef.current = setInterval(async () => {
      try {
        const msgs = await getMessages(token, matchId)
        setMessages(msgs)
      } catch {
        // silent poll failure
      }
    }, 3000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [token, matchId])

  // Send message
  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending || !matchId) return

    setSending(true)
    try {
      const msg = await sendMessage(token, matchId, body)
      setMessages((prev) => [...prev, msg])
      setDraft('')
      inputRef.current?.focus()
    } catch {
      // send failed silently
    } finally {
      setSending(false)
    }
  }

  // Derive counterpart name
  const otherName = role === 'worker'
    ? matchInfo?.employer?.company_name ?? 'Employer'
    : matchInfo?.worker?.name ?? 'Worker'

  if (loading) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center max-w-sm">
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/matches')}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-white">
            {otherName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{otherName}</p>
          <p className="text-xs text-gray-400">
            {matchInfo ? `Matched ${new Date(matchInfo.matched_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">👋</p>
            <p className="text-gray-500 text-sm">Say hello to {otherName}!</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const showTimestamp = !prev || diffMinutes(prev.created_at, msg.created_at) > 5

          return (
            <div key={msg.id}>
              {showTimestamp && (
                <p className="text-center text-xs text-gray-400 my-3">
                  {formatTimestamp(msg.created_at)}
                </p>
              )}
              <div className={`flex ${msg.is_mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed
                    ${msg.is_mine
                      ? 'bg-brand-500 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-900 rounded-bl-md'
                    }`}
                >
                  {msg.body}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a message..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={5000}
          className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-300 focus:bg-white
                     border border-transparent focus:border-brand-300 transition-all"
          autoFocus
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center
                     hover:bg-brand-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                     active:scale-90"
          aria-label="Send"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col max-w-2xl mx-auto w-full">
      {children}
    </div>
  )
}

function diffMinutes(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()

  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`

  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}
