// The website installs as an app (PWA) on computers and iPhones: recruiters
// mostly use Macs and iPhones, and the native iPhone app needs a Mac first
// (user 2026-11-14). These pick the right install steps for each device.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStandalone, platformOf } from '../pwa'
import manifestText from '../../../public/manifest.webmanifest?raw'
import serviceWorker from '../../../public/sw.js?raw'
import indexHtml from '../../../index.html?raw'

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // iPadOS asks for the desktop site: it says "Macintosh" but has a touch screen.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
}

describe('platformOf', () => {
  it('knows iPhones and iPads (even when the iPad asks for the desktop site)', () => {
    expect(platformOf(UA.iphone, 5)).toBe('ios')
    expect(platformOf(UA.ipad, 5)).toBe('ios')
  })

  it('tells Safari on a Mac apart from other Mac browsers', () => {
    expect(platformOf(UA.macSafari, 0)).toBe('mac-safari')
    expect(platformOf(UA.macChrome, 0)).toBe('desktop')
  })

  it('knows Windows and Android', () => {
    expect(platformOf(UA.windowsEdge, 0)).toBe('desktop')
    expect(platformOf(UA.android, 5)).toBe('android')
  })
})

describe('isStandalone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false in a browser tab', () => {
    expect(isStandalone()).toBe(false)
  })

  it('is true when opened from the installed icon', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    expect(isStandalone()).toBe(true)
  })
})

// The image files in public/icons, as '/icons/<name>' (how pages ask for them).
const iconFiles = Object.keys(import.meta.glob('../../../public/icons/*.png')).map((p) => p.replace('../../../public', ''))

describe('web app manifest', () => {
  const manifest = JSON.parse(manifestText)

  it('opens the site in its own window, at the start page', () => {
    expect(manifest.name).toBe('JobSwipe')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
  })

  it('has the icons browsers need, and the files exist', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
    for (const icon of manifest.icons) expect(iconFiles).toContain(icon.src)
  })

  it('index.html links it, with the iPhone icon and title', () => {
    const html = indexHtml
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="JobSwipe"')
    expect(iconFiles).toContain('/icons/apple-touch-icon.png')
  })
})

describe('service worker', () => {
  type Handler = (e: unknown) => void
  // Runs public/sw.js against a fake worker and returns its fetch handler.
  function loadWorker() {
    const handlers: Record<string, Handler> = {}
    const self = {
      addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
      skipWaiting: vi.fn(), clients: { claim: vi.fn() }, location: { origin: 'https://jobswipe.test' },
    }
    const caches = { open: vi.fn(async () => ({ add: vi.fn() })), match: vi.fn(async () => 'offline page') }
    const fetchFn = vi.fn(async () => { throw new TypeError('offline') })
    new Function('self', 'caches', 'fetch', serviceWorker)(self, caches, fetchFn)
    const fetchEvent = (url: string, mode = 'navigate', method = 'GET') => {
      const respondWith = vi.fn()
      handlers.fetch({ request: { url, mode, method }, respondWith })
      return respondWith
    }
    return { handlers, fetchEvent, caches }
  }

  it('shows the offline page when a page cannot load', async () => {
    const { fetchEvent, caches } = loadWorker()
    const respondWith = fetchEvent('https://jobswipe.test/feed')
    expect(respondWith).toHaveBeenCalled()
    expect(await respondWith.mock.calls[0][0]).toBe('offline page')
    expect(caches.match).toHaveBeenCalledWith('/offline.html')
  })

  it('leaves everything else alone: the API, downloads, files, other sites', () => {
    const { fetchEvent } = loadWorker()
    expect(fetchEvent('https://jobswipe.test/api/feed', 'cors')).not.toHaveBeenCalled()
    expect(fetchEvent('https://jobswipe.test/downloads/jobswipe.apk')).not.toHaveBeenCalled()
    expect(fetchEvent('https://jobswipe.test/assets/index.js', 'no-cors')).not.toHaveBeenCalled()
    expect(fetchEvent('https://accounts.google.com/o/oauth2')).not.toHaveBeenCalled()
    expect(fetchEvent('https://jobswipe.test/feed', 'navigate', 'POST')).not.toHaveBeenCalled()
  })
})
