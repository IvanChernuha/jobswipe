// Testers on the website (iPhone and Mac users have no app yet) rate JobSwipe
// from their Profile, like in the phone app. The admin page's Feedback tab
// shows it, with whether they used the installed website and on what device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as api from '../../lib/api'
import FeedbackCard from '../FeedbackCard'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  sendFeedback: vi.fn(),
}))
const sendFeedback = vi.mocked(api.sendFeedback)

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

beforeEach(() => { sendFeedback.mockReset() })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('feedback on the website', () => {
  it('sends the stars and the comment, and thanks you', async () => {
    sendFeedback.mockResolvedValue({ ok: true })
    render(<FeedbackCard token="tok" />)
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }))
    fireEvent.change(screen.getByLabelText('Your comments'), { target: { value: '  Love the swiping  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText('Thanks! We read every message.')).toBeInTheDocument()
    expect(sendFeedback).toHaveBeenCalledWith('tok', {
      rating: 4, message: 'Love the swiping', platform: 'web', app_version: 'browser desktop',
    })
  })

  it('says it came from the installed website on an iPhone', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    sendFeedback.mockResolvedValue({ ok: true })
    render(<FeedbackCard token="tok" />)
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await screen.findByText('Thanks! We read every message.')
    expect(sendFeedback).toHaveBeenCalledWith('tok', expect.objectContaining({ app_version: 'installed ios' }))
  })

  it('needs a rating first', () => {
    render(<FeedbackCard token="tok" />)
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
  })

  it('says why it was not sent, and keeps what you wrote', async () => {
    sendFeedback.mockRejectedValue(new Error('Too many requests'))
    render(<FeedbackCard token="tok" />)
    fireEvent.click(screen.getByRole('radio', { name: '2 stars' }))
    fireEvent.change(screen.getByLabelText('Your comments'), { target: { value: 'Slow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText('Too many requests')).toBeInTheDocument()
    expect(screen.getByLabelText('Your comments')).toHaveValue('Slow')
  })
})
