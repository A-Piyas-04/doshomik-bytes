import { useLocalSearchParams } from 'expo-router';
import { PracticeSessionScreen } from '@/features/learn/PracticeScreens';

export default function PracticeSessionRoute() {
  const { field, topic, quiz } = useLocalSearchParams<{ field?: string; topic?: string; quiz?: string }>();
  return <PracticeSessionScreen field={field} topic={topic} quiz={quiz} />;
}
