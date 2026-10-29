import { useTranslation } from 'react-i18next'
import ComingSoon from '../../components/ComingSoon'

export default function Team() {
  const { t } = useTranslation()
  return <ComingSoon testID="screen-team" title={t('nav.team')} />
}
