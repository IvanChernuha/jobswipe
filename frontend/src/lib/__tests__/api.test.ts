// Characterization tests for the API client: they lock in what the web client
// does TODAY, before it moves into packages/shared (Mobile P1). They must pass
// before and after the move, unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEmployerFeed, getMatches, getWorkerFeed, loginUser, parseJobFiles, postSwipe,
  removeBookmark, uploadAvatar,
} from '../api'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function lastCall(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url, init }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request basics', () => {
  it('prefixes /api and sends JSON with no token for public calls', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 't' }))
    await loginUser('a@b.com', 'pw')
    const { url, init } = lastCall()
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com', password: 'pw' })
  })

  it('sends the Bearer token on authenticated calls', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getMatches('tok123')
    expect(lastCall().init.headers.Authorization).toBe('Bearer tok123')
  })

  it('returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(json(200, [{ id: 'm1' }]))
    await expect(getMatches('t')).resolves.toEqual([{ id: 'm1' }])
  })

  it('returns undefined on 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(removeBookmark('t', 'w1')).resolves.toBeUndefined()
  })
})

describe('errors', () => {
  it('uses a string detail as the message', async () => {
    fetchMock.mockResolvedValue(json(400, { detail: 'Already swiped' }))
    await expect(postSwipe('t', { target_id: 'x', direction: 'like' } as never)).rejects.toThrow('Already swiped')
  })

  it('flattens FastAPI validation errors into one friendly line', async () => {
    fetchMock.mockResolvedValue(json(422, {
      detail: [
        { msg: 'Value error, salary_min cannot exceed salary_max' },
        { msg: 'Field required' },
      ],
    }))
    await expect(getMatches('t')).rejects.toThrow('Min salary cannot exceed Max salary; Field required')
  })

  it('falls back to `message`, then to the HTTP status', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { message: 'Boom' }))
    await expect(getMatches('t')).rejects.toThrow('Boom')
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(getMatches('t')).rejects.toThrow('HTTP 502')
  })

  it('fires jobswipe:unauthorized on a 401 for an authenticated call', async () => {
    const listener = vi.fn()
    window.addEventListener('jobswipe:unauthorized', listener)
    fetchMock.mockResolvedValue(json(401, { detail: 'Token expired' }))
    await expect(getMatches('t')).rejects.toThrow('Token expired')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('jobswipe:unauthorized', listener)
  })

  it('does not fire jobswipe:unauthorized on a 401 without a token (bad login)', async () => {
    const listener = vi.fn()
    window.addEventListener('jobswipe:unauthorized', listener)
    fetchMock.mockResolvedValue(json(401, { detail: 'Invalid credentials' }))
    await expect(loginUser('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials')
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('jobswipe:unauthorized', listener)
  })
})

describe('feeds', () => {
  it('worker feed calls /employers/feed with only the filters that are set', async () => {
    fetchMock.mockImplementation(async () => json(200, []))
    await getWorkerFeed('t')
    expect(lastCall().url).toBe('/api/employers/feed')
    await getWorkerFeed('t', { location: 'Tel Aviv', salary_min: 0, remote: false })
    expect(lastCall().url).toBe('/api/employers/feed?location=Tel+Aviv&salary_min=0&remote=false')
  })

  it('employer feed calls /workers/feed with experience filters', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getEmployerFeed('t', { experience_min: 0, experience_max: 2 })
    expect(lastCall().url).toBe('/api/workers/feed?experience_min=0&experience_max=2')
  })
})

describe('uploads', () => {
  it('sends a file as multipart form data without a JSON Content-Type', async () => {
    fetchMock.mockResolvedValue(json(200, { url: '/supabase/a.png' }))
    const file = new File(['png'], 'me.png', { type: 'image/png' })
    await expect(uploadAvatar('t', file)).resolves.toEqual({ url: '/supabase/a.png' })
    const { url, init } = lastCall()
    expect(url).toBe('/api/uploads/avatar')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('parse-job-files sends every file under "files" and unwraps `parsed`', async () => {
    fetchMock.mockResolvedValue(json(200, { parsed: [{ filename: 'a.pdf' }, { filename: 'b.pdf' }] }))
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]
    await expect(parseJobFiles('t', files)).resolves.toEqual([{ filename: 'a.pdf' }, { filename: 'b.pdf' }])
    expect((lastCall().init.body as FormData).getAll('files')).toHaveLength(2)
  })
})
