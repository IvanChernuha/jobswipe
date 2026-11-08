import { useLocalSearchParams } from 'expo-router'
import JobForm from '../../components/JobForm'

export default function EditJob() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <JobForm jobId={id} />
}
