import { useLocalSearchParams } from 'expo-router';
import { PaperScreen } from '@/features/research/PaperScreen';

export default function PaperRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PaperScreen id={id} />;
}
