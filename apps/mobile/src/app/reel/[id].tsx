import { useLocalSearchParams } from 'expo-router';
import { ReelViewer } from '@/features/reels/ReelsScreens';

export default function ReelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReelViewer id={id} />;
}
