import { useLocalSearchParams } from 'expo-router';
import { RoadmapsScreen } from '@/features/research/RoadmapsScreen';

export default function RoadmapsRoute() {
  const { field } = useLocalSearchParams<{ field?: string }>();
  return <RoadmapsScreen initialField={field} />;
}
