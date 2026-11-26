import { useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/features/profile/ProfileView';

export default function UserRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView userId={id} />;
}
