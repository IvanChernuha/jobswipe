// The /app page: testers download the Android app before there is an
// iPhone version or a Play Store listing (user idea 2026-11-12). The file
// and its details are published to /downloads by scripts/mobile/publish-apk.sh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DownloadApp from '../DownloadApp'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

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

  it('says iPhone is coming', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: '0.7.0', size_mb: 36, file: 'jobswipe.apk' })))
    page()
    expect(await screen.findByText(/iPhone version is coming/)).toBeInTheDocument()
  })

  it('without a published app, says it is coming soon instead of a broken link', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }))
    page()
    expect(await screen.findByText(/The Android app is almost ready/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Download for Android/ })).toBeNull()
  })
})
