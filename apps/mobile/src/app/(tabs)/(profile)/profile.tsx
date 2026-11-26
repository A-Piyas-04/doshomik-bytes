import { useMe } from '@/api/social';
import { ProfileView } from '@/features/profile/ProfileView';

export default function ProfileTab() {
  const me = useMe();
  return <ProfileView userId={me.data?.id} isTab />;
}
