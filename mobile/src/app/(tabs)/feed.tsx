import { useTranslation } from 'react-i18next'
import ComingSoon from '../../components/ComingSoon'

export default function Feed() {
  const { t } = useTranslation()
  return <ComingSoon testID="screen-feed" title={t('nav.feed')} />
}
