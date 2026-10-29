import { useTranslation } from 'react-i18next'
import ComingSoon from '../../components/ComingSoon'

export default function Saved() {
  const { t } = useTranslation()
  return <ComingSoon testID="screen-saved" title={t('nav.saved')} />
}
