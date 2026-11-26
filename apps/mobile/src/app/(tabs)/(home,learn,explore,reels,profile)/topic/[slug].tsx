import { useLocalSearchParams } from 'expo-router';
import { TopicScreen } from '@/features/learn/TopicScreen';

export default function TopicRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <TopicScreen slug={slug} />;
}
