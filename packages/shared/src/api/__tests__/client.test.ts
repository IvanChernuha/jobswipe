// What the mobile app needs from the shared API client, beyond what the web
// characterization tests (frontend/src/lib/__tests__/api.test.ts) cover:
// an absolute server address, a callback instead of a window event, and
// React Native style file uploads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, getEmployerFeed, getFeedback, getMatches, getMatchResume, moveMatch, parseJobText, sendFeedback, uploadAvatar, uploadResume } from '..'

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

describe('parseJobText (Fill with AI)', () => {
  it('sends the typed posting and returns the form data', async () => {
    const parsed = { title: 'Junior React Developer', required_tag_ids: ['t1'], preferred_tag_ids: [], tag_ids: ['t2'] }
    fetchMock.mockResolvedValue(json(200, parsed))
    await expect(parseJobText('tok', 'We need a junior React developer')).resolves.toEqual(parsed)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/cv/parse-job-text')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ text: 'We need a junior React developer' })
  })
})

describe('employer feed for one job (job switcher)', () => {
  it('asks for candidates for that job only', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getEmployerFeed('tok', { job_id: 'j1' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workers/feed?job_id=j1')
  })

  it('without a job asks for all jobs', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getEmployerFeed('tok')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workers/feed')
  })
})

describe('getMatchResume', () => {
  it("returns a fresh link to the matched candidate's CV", async () => {
    fetchMock.mockResolvedValue(json(200, { url: '/supabase/storage/v1/object/sign/resumes/x?token=t' }))
    await expect(getMatchResume('tok', 'm1')).resolves.toBe('/supabase/storage/v1/object/sign/resumes/x?token=t')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/matches/m1/resume')
  })
})

describe('moveMatch', () => {
  it('puts the match under another job and returns it', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'm1', job_posting_id: 'j2' }))
    await expect(moveMatch('tok', 'm1', 'j2')).resolves.toMatchObject({ job_posting_id: 'j2' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/matches/m1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ job_posting_id: 'j2' })
  })
})

describe('feedback', () => {
  it('sends a rating and a comment', async () => {
    fetchMock.mockResolvedValue(json(201, { ok: true }))
    await sendFeedback('tok', { rating: 4, message: 'Nice', platform: 'android', app_version: '0.7.0' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ rating: 4, message: 'Nice', platform: 'android', app_version: '0.7.0' })
  })

  it('admins read it', async () => {
    fetchMock.mockResolvedValue(json(200, [{ id: 'f1', rating: 5 }]))
    await expect(getFeedback('tok')).resolves.toEqual([{ id: 'f1', rating: 5 }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback')
  })
})
