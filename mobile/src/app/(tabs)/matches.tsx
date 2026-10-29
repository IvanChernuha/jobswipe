import { useTranslation } from 'react-i18next'
import ComingSoon from '../../components/ComingSoon'

export default function Matches() {
  const { t } = useTranslation()
  return <ComingSoon testID="screen-matches" title={t('nav.matches')} />
}
