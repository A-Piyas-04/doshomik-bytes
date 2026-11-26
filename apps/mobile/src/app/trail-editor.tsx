import { useLocalSearchParams } from 'expo-router';
import { TrailEditorScreen } from '@/features/research/TrailEditorScreen';

export default function TrailEditorRoute() {
  const { id, paper } = useLocalSearchParams<{ id?: string; paper?: string }>();
  return <TrailEditorScreen id={id} initialPaper={paper} />;
}
