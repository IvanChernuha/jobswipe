/**
 * The website as an installable app (PWA): an icon on the desktop, Dock or
 * Home Screen that opens JobSwipe in its own window. It's how iPhone and Mac
 * users get an app before the native iPhone one (that needs a Mac to build).
 */
import { useEffect, useState } from 'react'

export type Platform = 'ios' | 'android' | 'mac-safari' | 'desktop'

/** Which install steps fit this device. */
export function platformOf(userAgent: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios'
  // iPadOS asks for the desktop site: it says "Macintosh" but has a touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  if (/Macintosh/.test(userAgent) && /Safari/.test(userAgent) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(userAgent)) {
    return 'mac-safari'
  }
  return 'desktop'
}

export function currentPlatform(): Platform {
  return platformOf(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

/** Opened from the installed icon rather than a browser tab? */
export function isStandalone(): boolean {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null
  return Boolean(media?.matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Chrome and Edge's "you can install this site" event. */
interface InstallOffer extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// The browser offers the install once, usually right after the page loads,
// which can be long before the /app page opens: keep it until it is used.
let offer: InstallOffer | null = null
let installed = false
let listening = false
const subscribers = new Set<() => void>()
const notify = () => subscribers.forEach((fn) => fn())

/** Start listening for the browser's install offer (main.tsx calls this at startup). */
export function listenForInstallOffer() {
  if (listening) return
  listening = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own button instead of the browser's mini bar
    offer = e as InstallOffer
    notify()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    installed = true
    notify()
  })
}

/** For tests: forget any offer from an earlier test. */
export function resetInstallPrompt() {
  offer = null
  installed = false
  notify()
}

/** `canInstall`: the browser can install it with one click; `install()` asks. */
export function useInstallPrompt() {
  const [, rerender] = useState(0)
  useEffect(() => {
    listenForInstallOffer()
    const update = () => rerender((n) => n + 1)
    subscribers.add(update)
    return () => { subscribers.delete(update) }
  }, [])

  async function install() {
    if (!offer) return
    const current = offer
    offer = null // the browser allows one prompt per offer
    await current.prompt()
    const choice = await current.userChoice
    if (choice.outcome === 'accepted') installed = true
    notify()
  }

  return { canInstall: offer !== null, installed, install }
}

/** Register the service worker (production only: in dev it would get in the way of reloads). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the site works without it */ })
  })
}
