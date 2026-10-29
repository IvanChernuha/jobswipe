import { useTranslation } from 'react-i18next'
import ComingSoon from '../../components/ComingSoon'

export default function Jobs() {
  const { t } = useTranslation()
  return <ComingSoon testID="screen-jobs" title={t('nav.jobs')} />
}
