// What the mobile app needs from the shared API client, beyond what the web
// characterization tests (frontend/src/lib/__tests__/api.test.ts) cover:
// an absolute server address, a callback instead of a window event, and
// React Native style file uploads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, getMatches, uploadAvatar, uploadResume } from '..'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  configureApi({ baseUrl: '/api', onUnauthorized: undefined })
})

describe('configureApi', () => {
  it('uses the configured absolute server address', async () => {
    configureApi({ baseUrl: 'https://jobswipe.example/api' })
    fetchMock.mockResolvedValue(json(200, []))
    await getMatches('t')
    expect(fetchMock.mock.calls[0][0]).toBe('https://jobswipe.example/api/matches')
  })

  it('calls onUnauthorized on a 401 for an authenticated call', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ onUnauthorized })
    fetchMock.mockResolvedValue(json(401, { detail: 'Token expired' }))
    await expect(getMatches('t')).rejects.toThrow('Token expired')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not need onUnauthorized to be set', async () => {
    fetchMock.mockResolvedValue(json(401, { detail: 'Token expired' }))
    await expect(getMatches('t')).rejects.toThrow('Token expired')
  })
})

describe('uploads from React Native', () => {
  it('accepts a { uri, name, type } file object, as React Native FormData expects', async () => {
    const appended: unknown[] = []
    class SpyFormData {
      append(name: string, value: unknown) { appended.push([name, value]) }
    }
    vi.stubGlobal('FormData', SpyFormData)
    fetchMock.mockResolvedValue(json(200, { url: '/supabase/cv.pdf' }))

    const file = { uri: 'file:///data/cv.pdf', name: 'cv.pdf', type: 'application/pdf' }
    await expect(uploadResume('t', file)).resolves.toEqual({ url: '/supabase/cv.pdf' })
    expect(appended).toEqual([['file', file]])
  })

  it('still accepts a browser File', async () => {
    fetchMock.mockResolvedValue(json(200, { url: '/supabase/a.png' }))
    await uploadAvatar('t', new File(['png'], 'a.png', { type: 'image/png' }))
    expect((fetchMock.mock.calls[0][1].body as FormData).get('file')).toBeInstanceOf(File)
  })
})
