import { useLocalSearchParams } from 'expo-router';
import { TrailScreen } from '@/features/research/TrailScreen';

export default function TrailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrailScreen id={id} />;
}
