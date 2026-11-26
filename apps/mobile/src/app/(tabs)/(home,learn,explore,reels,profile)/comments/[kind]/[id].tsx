import { useLocalSearchParams } from 'expo-router';
import { CommentsScreen } from '@/features/social/CommentsScreen';

export default function CommentsRoute() {
  const { kind, id, focus } = useLocalSearchParams<{ kind: 'posts' | 'papers'; id: string; focus?: string }>();
  return <CommentsScreen thread={{ kind: kind === 'papers' ? 'papers' : 'posts', id }} focus={focus === '1'} />;
}
