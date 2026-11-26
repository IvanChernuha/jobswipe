// The /app page: testers download the Android app before there is an
// iPhone version or a Play Store listing (user idea 2026-11-12). The file
// and its details are published to /downloads by scripts/mobile/publish-apk.sh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DownloadApp from '../DownloadApp'
import { resetInstallPrompt } from '../../lib/pwa'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetInstallPrompt()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const onDevice = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
const noApk = () => fetchMock.mockResolvedValue(new Response('not found', { status: 404 }))

const page = () => render(<MemoryRouter><DownloadApp /></MemoryRouter>)

describe('download page', () => {
  it('offers the latest Android app with its version and size', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      version: '0.7.0', size_mb: 36.2, updated_at: '2026-11-12T10:00:00Z', file: 'jobswipe.apk',
    }), { status: 200 }))
    page()
    const link = await screen.findByRole('link', { name: /Download for Android/ })
    expect(link).toHaveAttribute('href', '/downloads/jobswipe.apk')
    expect(screen.getByText(/Version 0.7.0/)).toBeInTheDocument()
    expect(screen.getByText(/36.2 MB/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/downloads/latest.json', expect.anything())
  })

  it('explains how to install it', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: '0.7.0', size_mb: 36, file: 'jobswipe.apk' })))
    page()
    await screen.findByRole('link', { name: /Download for Android/ })
    expect(screen.getByText(/Install unknown apps/)).toBeInTheDocument()
  })

  it('says a native iPhone app is coming', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: '0.7.0', size_mb: 36, file: 'jobswipe.apk' })))
    page()
    expect(await screen.findByText(/native iPhone app is coming/)).toBeInTheDocument()
  })

  it('without a published app, says it is coming soon instead of a broken link', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }))
    page()
    expect(await screen.findByText(/The Android app is almost ready/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Download for Android/ })).toBeNull()
  })
})

// The website installs as an app on computers and iPhones (PWA): most
// recruiters use Macs and iPhones, and there is no iPhone app yet.
describe('install the website as an app', () => {
  it('on a computer whose browser can install it, one button does it', async () => {
    onDevice(WINDOWS)
    noApk()
    page()
    const prompt = vi.fn(async () => {})
    const offer = Object.assign(new Event('beforeinstallprompt'), {
      prompt, userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    await act(async () => { window.dispatchEvent(offer) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install JobSwipe' })))
    expect(prompt).toHaveBeenCalled()
    expect(await screen.findByText(/Installed!/)).toBeInTheDocument()
  })

  it('on a computer without the button, says where the browser keeps it', async () => {
    onDevice(WINDOWS)
    noApk()
    page()
    expect(await screen.findByText(/install icon at the right end of the address bar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install JobSwipe' })).toBeNull()
  })

  it('on an iPhone, explains Add to Home Screen first', async () => {
    onDevice(IPHONE)
    noApk()
    page()
    const steps = await screen.findByTestId('install-steps')
    expect(steps).toHaveTextContent(/Share/)
    expect(steps).toHaveTextContent(/Add to Home Screen/)
  })

  it('on a Mac in Safari, explains Add to Dock', async () => {
    onDevice(MAC_SAFARI)
    noApk()
    page()
    expect(await screen.findByTestId('install-steps')).toHaveTextContent(/Add to Dock/)
  })

  it('the other devices are one click away', async () => {
    onDevice(WINDOWS)
    noApk()
    page()
    fireEvent.click(await screen.findByText('Other devices'))
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.getByText(/Add to Dock/)).toBeInTheDocument()
  })

  it('opened from the installed icon, says so instead', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    noApk()
    page()
    expect(await screen.findByText(/using the installed JobSwipe app/)).toBeInTheDocument()
    expect(screen.queryByTestId('install-steps')).toBeNull()
  })
})
