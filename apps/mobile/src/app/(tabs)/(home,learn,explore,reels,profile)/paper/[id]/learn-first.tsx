import { useLocalSearchParams } from 'expo-router';
import { LearnFirstScreen } from '@/features/research/LearnFirstScreen';

export default function LearnFirstRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LearnFirstScreen id={id} />;
}
