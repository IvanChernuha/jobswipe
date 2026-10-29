import { Redirect } from 'expo-router'
import { useAuth } from '../context/AuthContext'

export default function Index() {
  const { session } = useAuth()
  return <Redirect href={session ? '/feed' : '/login'} />
}
