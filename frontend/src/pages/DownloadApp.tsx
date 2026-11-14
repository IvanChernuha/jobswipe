import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../components/Icon'

/** What scripts/mobile/publish-apk.sh writes next to the app file. */
interface Latest {
  version: string
  size_mb: number
  file: string
  updated_at?: string
}

/**
 * /app: download the Android app (testers, before the Play Store and the
 * iPhone version). The file and latest.json live in /downloads on the server.
 */
export default function DownloadApp() {
  const { t } = useTranslation()
  const [latest, setLatest] = useState<Latest | null>(null)
  const [missing, setMissing] = useState(false)
  const [qr, setQr] = useState(true)

  useEffect(() => {
    fetch('/downloads/latest.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        setLatest((await res.json()) as Latest)
      })
      .catch(() => setMissing(true))
  }, [])

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex justify-center px-4 py-10">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">{t('download.title')}</h1>
          <p className="mt-2 text-gray-600">{t('download.subtitle')}</p>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 text-center space-y-3">
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
            <h2 className="font-semibold text-gray-900 mb-3">{t('download.installTitle')}</h2>
            <ol className="list-decimal ps-5 space-y-2 text-sm text-gray-700">
              <li>{t('download.step1')}</li>
              <li>{t('download.step2')}</li>
              <li>{t('download.step3')}</li>
            </ol>
          </div>
        )}

        {latest && qr && (
          <div className="hidden sm:block text-center text-sm text-gray-600">
            <p className="mb-2">{t('download.scan')}</p>
            <img src="/downloads/qr.png" alt="" width={180} height={180} className="mx-auto rounded-xl" onError={() => setQr(false)} />
          </div>
        )}

        <p className="text-sm text-gray-600 text-center">{t('download.iphone')}</p>
        <p className="text-sm text-gray-500 text-center">{t('download.feedback')}</p>
      </div>
    </div>
  )
}
