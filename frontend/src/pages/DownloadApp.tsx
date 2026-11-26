import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../components/Icon'
import { currentPlatform, isStandalone, useInstallPrompt, type Platform } from '../lib/pwa'

/** What scripts/mobile/publish-apk.sh writes next to the app file. */
interface Latest {
  version: string
  size_mb: number
  file: string
  updated_at?: string
}

/** Install steps for each device, the visitor's own first. */
const STEPS: Record<Exclude<Platform, 'android'>, string> = {
  ios: 'download.howIos',
  'mac-safari': 'download.howMac',
  desktop: 'download.howDesktop',
}

/**
 * /app: get JobSwipe as an app. Android: download the app file (testers,
 * before the Play Store). iPhone, iPad and computers: install the website
 * as an app (PWA) until the native iPhone app exists. The Android file and
 * latest.json live in /downloads on the server.
 */
export default function DownloadApp() {
  const { t } = useTranslation()
  const [latest, setLatest] = useState<Latest | null>(null)
  const [missing, setMissing] = useState(false)
  const [qr, setQr] = useState(true)
  const platform = currentPlatform()

  useEffect(() => {
    fetch('/downloads/latest.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        setLatest((await res.json()) as Latest)
      })
      .catch(() => setMissing(true))
  }, [])

  const android = (
    <section key="android" className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-center space-y-3">
        <h2 className="font-semibold text-gray-900">{t('download.androidTitle')}</h2>
        {latest && (
          <>
            <a
              href={`/downloads/${latest.file}`}
              download
              className="btn-primary inline-flex items-center justify-center gap-2 w-full min-h-[52px] text-base"
            >
              <Icon name="download" className="w-5 h-5" />
              {t('download.androidButton')}
            </a>
            <p className="text-sm text-gray-500">
              {t('download.versionInfo', { version: latest.version, size: latest.size_mb })}
            </p>
          </>
        )}
        {missing && <p className="text-gray-700">{t('download.notReady')}</p>}
        {!latest && !missing && (
          <div className="w-8 h-8 mx-auto border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        )}
      </div>

      {latest && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-3">{t('download.installTitle')}</h3>
          <ol className="list-decimal ps-5 space-y-2 text-sm text-gray-700">
            <li>{t('download.step1')}</li>
            <li>{t('download.step2')}</li>
            <li>{t('download.step3')}</li>
          </ol>
        </div>
      )}

      {latest && qr && platform !== 'android' && (
        <div className="hidden sm:block text-center text-sm text-gray-600">
          <p className="mb-2">{t('download.scan')}</p>
          <img src="/downloads/qr.png" alt="" width={180} height={180} className="mx-auto rounded-xl" onError={() => setQr(false)} />
        </div>
      )}
    </section>
  )

  const web = <InstallWebApp key="web" platform={platform} />

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex justify-center px-4 py-10">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">{t('download.title')}</h1>
          <p className="mt-2 text-gray-600">{t('download.subtitle')}</p>
        </div>

        {platform === 'android' ? [android, web] : [web, android]}

        <p className="text-sm text-gray-600 text-center">{t('download.iphone')}</p>
        <p className="text-sm text-gray-500 text-center">{t('download.feedback')}</p>
      </div>
    </div>
  )
}

/** iPhone, iPad, Mac, Windows: the website as an app, with steps for this device. */
function InstallWebApp({ platform }: { platform: Platform }) {
  const { t } = useTranslation()
  const { canInstall, installed, install } = useInstallPrompt()
  const standalone = isStandalone()
  const mine = platform === 'android' ? null : STEPS[platform]
  const others = (Object.values(STEPS)).filter((key) => key !== mine)

  return (
    <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="text-center">
        <h2 className="font-semibold text-gray-900">{t('download.webTitle')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('download.webIntro')}</p>
      </div>

      {standalone ? (
        <p className="text-center text-brand-700 font-medium">{t('download.standalone')}</p>
      ) : installed ? (
        <p className="text-center text-brand-700 font-medium">{t('download.installed')}</p>
      ) : (
        <>
          {canInstall && (
            <button
              type="button"
              onClick={() => void install()}
              className="btn-primary inline-flex items-center justify-center gap-2 w-full min-h-[52px] text-base"
            >
              <Icon name="download" className="w-5 h-5" />
              {t('download.installButton')}
            </button>
          )}
          {!canInstall && mine && (
            <p data-testid="install-steps" className="text-gray-800 bg-brand-50 rounded-2xl p-4">{t(mine)}</p>
          )}
          <details className="text-sm text-gray-700">
            <summary className="cursor-pointer text-brand-700 font-medium">{t('download.otherDevices')}</summary>
            <ul className="mt-2 space-y-2 list-disc ps-5">
              {(canInstall && mine ? [mine, ...others] : others).map((key) => <li key={key}>{t(key)}</li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}
